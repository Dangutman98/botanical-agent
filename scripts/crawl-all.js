/**
 * crawl-all.js — Full botanical knowledge crawler
 * Discovers URLs via sitemaps, scrapes content, chunks it,
 * and ingests into Pinecone + local BM25 cache via /api/ingestion.
 *
 * Run: node scripts/crawl-all.js
 * Requirements: dev server must be running on localhost:3000
 */

const fs   = require('fs');
const path = require('path');

const cheerio = (() => { try { return require('cheerio'); } catch { console.error('Run: npm install cheerio'); process.exit(1); } })();

// ─── Config ───────────────────────────────────────────────────────────────────
const INGESTION_URL      = 'http://127.0.0.1:3000/api/ingestion';
const INGESTED_URLS_FILE = path.join(__dirname, '..', 'data', 'ingested_urls.json');
const CHUNK_SIZE         = 1200;   // characters per chunk
const CHUNK_OVERLAP      = 150;    // overlap between chunks
const REQUEST_DELAY_MS   = 1200;   // polite delay between requests
const MAX_URLS_PER_DOMAIN = 500;   // safety cap

// ─── Seed URLs per domain (sitemaps + manual seeds) ───────────────────────────
const DOMAIN_SEEDS = {
  'bara.co.il': {
    sitemaps: [
      'https://bara.co.il/sitemap_index.xml',
      'https://bara.co.il/sitemap.xml',
      'https://bara.co.il/post-sitemap.xml',
    ],
    seeds: ['https://bara.co.il/'],
    selector: '.entry-content, article, main, #content, .elementor-widget-theme-post-content',
  },
  'trifolium.co.il': {
    sitemaps: [
      'https://trifolium.co.il/sitemap_index.xml',
      'https://trifolium.co.il/sitemap.xml',
      'https://trifolium.co.il/post-sitemap.xml',
    ],
    seeds: ['https://trifolium.co.il/blog/'],
    selector: '.entry-content, article, main, .blog-post-content, #content',
  },
  'naturopedia.com': {
    sitemaps: [
      'https://naturopedia.com/sitemap_index.xml',
      'https://naturopedia.com/sitemap.xml',
    ],
    seeds: [
      'https://naturopedia.com/herbs/',
      'https://naturopedia.com/vitamins/',
      'https://naturopedia.com/supplements/',
    ],
    selector: '.entry-content, article, main, .herb-content, #content',
  },
  'medlineplus.gov': {
    sitemaps: [],
    seeds: [
      'https://medlineplus.gov/herbalmedicine.html',
      'https://medlineplus.gov/druginfo/herb_All.html',
    ],
    selector: '#ency_summary, .page-details, article, main, #mplus-content',
  },
  'nccih.nih.gov': {
    sitemaps: [
      'https://www.nccih.nih.gov/sitemap.xml',
    ],
    seeds: [
      'https://www.nccih.nih.gov/health/herbsataglance',
      'https://www.nccih.nih.gov/health',
    ],
    selector: '#main-content, .field-items, article, main',
  },
  'ajcn.nutrition.org': {
    sitemaps: [
      'https://academic.oup.com/ajcn/sitemap.xml',
    ],
    seeds: [
      'https://academic.oup.com/ajcn',
    ],
    selector: '.article-body, .abstract, .full-text, article, main',
  },
};

// ─── URL Filter ───────────────────────────────────────────────────────────────
const EXCLUDED_PATTERNS = [
  /\/cart\/?/i, /\/checkout\/?/i, /\/my-account\/?/i, /\/shop\/?$/i,
  /\/contact\/?/i, /\/privacy\/?/i, /\/terms\/?/i, /\/about\/?/i,
  /\/404\/?/i, /\/tag\/?/i, /\/author\/?/i, /\/wp-admin\/?/i,
  /\/feed\/?/i, /\.(jpg|jpeg|png|gif|pdf|zip|mp4|mp3)$/i,
  /\/affiliate\/?/i, /\/registration\/?/i, /\/login\/?/i,
  /\/page\/\d+\/?$/i,  // pagination pages
];

function isAllowedUrl(url, domain) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace('www.', '').toLowerCase();
    if (!host.includes(domain) && !domain.includes(host)) return false;
    const p = parsed.pathname.toLowerCase();
    if (p === '/' || p === '') return false;
    return !EXCLUDED_PATTERNS.some(rx => rx.test(p));
  } catch { return false; }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function chunkText(text, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  const chunks = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + size, text.length);
    const chunk = text.slice(start, end).trim();
    if (chunk.length > 200) chunks.push(chunk);
    start += size - overlap;
  }
  return chunks;
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; BotanicalAgent/1.0; +https://botanical-agent.vercel.app)',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'he,en;q=0.8',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// ─── Sitemap parser ───────────────────────────────────────────────────────────
async function discoverUrlsFromSitemap(sitemapUrl) {
  const urls = [];
  try {
    console.log(`  📋 Fetching sitemap: ${sitemapUrl}`);
    const xml = await fetchText(sitemapUrl);

    // Sub-sitemaps (sitemap index)
    const subSitemapMatches = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)];
    const subSitemaps = subSitemapMatches
      .map(m => m[1].trim())
      .filter(u => u.includes('sitemap') && u.endsWith('.xml'));

    if (subSitemaps.length > 0) {
      console.log(`  🗂️  Found ${subSitemaps.length} sub-sitemaps`);
      for (const sub of subSitemaps.slice(0, 20)) {
        try {
          const subUrls = await discoverUrlsFromSitemap(sub);
          urls.push(...subUrls);
          await sleep(300);
        } catch (e) {
          console.warn(`  ⚠️  Failed sub-sitemap ${sub}: ${e.message}`);
        }
      }
    } else {
      // Leaf sitemap with actual URLs
      const pageUrls = subSitemapMatches
        .map(m => m[1].trim())
        .filter(u => !u.includes('sitemap') && !u.endsWith('.xml'));
      urls.push(...pageUrls);
      console.log(`  ✅ Found ${pageUrls.length} URLs in sitemap`);
    }
  } catch (e) {
    console.warn(`  ⚠️  Sitemap error for ${sitemapUrl}: ${e.message}`);
  }
  return urls;
}

// ─── Link crawler (fallback for sites without good sitemaps) ──────────────────
async function crawlLinks(seedUrl, domain, maxPages = 100) {
  const discovered = new Set();
  const queue = [seedUrl];
  const visited = new Set([seedUrl]);

  while (queue.length > 0 && discovered.size < maxPages) {
    const url = queue.shift();
    try {
      const html = await fetchText(url);
      const $ = cheerio.load(html);
      $('a[href]').each((_, el) => {
        try {
          const href = new URL($(el).attr('href'), url).href.split('#')[0].split('?')[0];
          if (!visited.has(href) && isAllowedUrl(href, domain)) {
            visited.add(href);
            queue.push(href);
            discovered.add(href);
          }
        } catch {}
      });
      await sleep(500);
    } catch (e) {
      console.warn(`  ⚠️  Link crawl error for ${url}: ${e.message}`);
    }
  }
  return [...discovered];
}

// ─── Page scraper ─────────────────────────────────────────────────────────────
function extractContent(html, selector) {
  const $ = cheerio.load(html);

  // Remove noise
  $('nav, footer, header, script, style, .sidebar, .menu, .comments, #comments, ' +
    '.wp-block-buttons, .sharedaddy, .related-posts, .widget, [class*="cookie"], ' +
    '[class*="banner"], [class*="popup"], [class*="modal"], [class*="newsletter"], ' +
    'figure > figcaption').remove();

  let content = '';
  const el = $(selector);
  if (el.length > 0) {
    content = el.text();
  }
  if (!content || content.length < 200) {
    content = $('body').text();
  }

  // Normalize Hebrew whitespace
  content = content
    .replace(/\s+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  const title = $('h1').first().text().trim()
    || $('title').text().split('|')[0].split('–')[0].split('-')[0].trim()
    || 'Botanical Document';

  return { title, content };
}

// ─── Ingest one chunk ─────────────────────────────────────────────────────────
async function ingestChunk(title, url, content) {
  const res = await fetch(INGESTION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, url, content }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Ingestion failed: ${res.status} ${err}`);
  }
  return res.json();
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('🌿 Botanical Knowledge Crawler — Starting\n');

  // Load already-ingested URLs to avoid duplicates
  let ingestedUrls = new Set();
  if (fs.existsSync(INGESTED_URLS_FILE)) {
    const arr = JSON.parse(fs.readFileSync(INGESTED_URLS_FILE, 'utf-8'));
    ingestedUrls = new Set(arr);
    console.log(`📦 Loaded ${ingestedUrls.size} already-ingested URLs\n`);
  }

  let totalNew = 0;
  let totalChunks = 0;

  for (const [domain, config] of Object.entries(DOMAIN_SEEDS)) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`🌐 Domain: ${domain}`);
    console.log('═'.repeat(60));

    // 1. Discover URLs via sitemaps
    let discoveredUrls = [];
    for (const sitemap of config.sitemaps) {
      const found = await discoverUrlsFromSitemap(sitemap);
      discoveredUrls.push(...found);
      await sleep(500);
    }

    // 2. If sitemaps gave few results, crawl links from seeds
    if (discoveredUrls.length < 10) {
      console.log(`  🔗 Few sitemap URLs found, crawling links from seeds...`);
      for (const seed of config.seeds) {
        const found = await crawlLinks(seed, domain, 80);
        discoveredUrls.push(...found);
        await sleep(500);
      }
    }

    // 3. Filter + deduplicate
    const filteredUrls = [...new Set(
      discoveredUrls
        .filter(u => isAllowedUrl(u, domain))
        .slice(0, MAX_URLS_PER_DOMAIN)
    )];

    const newUrls = filteredUrls.filter(u => !ingestedUrls.has(u));
    console.log(`  📊 Discovered: ${filteredUrls.length} | New (not yet ingested): ${newUrls.length}`);

    if (newUrls.length === 0) {
      console.log(`  ✅ All URLs already ingested for ${domain}`);
      continue;
    }

    // 4. Scrape + chunk + ingest each new URL
    for (let i = 0; i < newUrls.length; i++) {
      const url = newUrls[i];
      process.stdout.write(`  [${i + 1}/${newUrls.length}] ${url.slice(0, 80)} ... `);

      try {
        const html = await fetchText(url);
        const { title, content } = extractContent(html, config.selector);

        if (content.length < 300) {
          console.log(`⚠️  Too short (${content.length} chars), skipping`);
          continue;
        }

        // Split into overlapping chunks
        const chunks = chunkText(content, CHUNK_SIZE, CHUNK_OVERLAP);
        console.log(`✂️  ${chunks.length} chunk(s)`);

        let chunkSuccessCount = 0;
        for (let ci = 0; ci < chunks.length; ci++) {
          const chunkTitle = chunks.length > 1 ? `${title} (Part ${ci + 1}/${chunks.length})` : title;
          try {
            await ingestChunk(chunkTitle, url, chunks[ci]);
            chunkSuccessCount++;
            totalChunks++;
            await sleep(400); // small delay between chunks to avoid HF rate limits
          } catch (e) {
            console.error(`\n    ❌ Chunk ${ci + 1} ingestion failed: ${e.message}`);
          }
        }

        if (chunkSuccessCount > 0) {
          ingestedUrls.add(url);
          totalNew++;

          // Save progress after each successful URL
          fs.writeFileSync(INGESTED_URLS_FILE, JSON.stringify([...ingestedUrls], null, 2));
        }
      } catch (e) {
        console.log(`❌ ${e.message}`);
      }

      await sleep(REQUEST_DELAY_MS);
    }
  }

  // ─── Final report ─────────────────────────────────────────────────────────
  console.log(`\n${'═'.repeat(60)}`);
  console.log('🎉 CRAWL COMPLETE!');
  console.log(`   New pages ingested : ${totalNew}`);
  console.log(`   New chunks created : ${totalChunks}`);
  console.log(`   Total URLs tracked : ${ingestedUrls.size}`);
  console.log('═'.repeat(60));
}

main().catch(err => {
  console.error('\n❌ Fatal error:', err);
  process.exit(1);
});
