/**
 * crawl-all.ts — Full botanical knowledge crawler (rebuilt)
 *
 * Discovers URLs via sitemaps, respects robots.txt, scrapes content with the
 * correct charset, chunks it along real sentence/paragraph boundaries, runs
 * every candidate through the corpus validation gate, and ingests into
 * Pinecone + the local BM25 cache via POST /api/ingestion.
 *
 * Rebuilt after discovering the previous version corrupted 68% of the corpus
 * (naturopedia.com served windows-1255, decoded here as UTF-8) and structurally
 * couldn't reach naturopedia's real articles at all (content lives in a query
 * string the old crawler stripped before filtering).
 *
 * Run: npx tsx scripts/crawl-all.ts
 * Requirements: dev server running on localhost:3000, INGESTION_SECRET set.
 */

import fs from 'fs';
import path from 'path';
import * as cheerio from 'cheerio';
import { fetchAndDecode } from '../lib/rag/charset';
import { chunkText } from '../lib/rag/chunker';
import { validateChunk } from '../lib/rag/corpus-validate';

// ─── Config ───────────────────────────────────────────────────────────────────
const INGESTION_URL = 'http://127.0.0.1:3000/api/ingestion';
const INGESTED_URLS_FILE = path.join(__dirname, '..', 'data', 'ingested_urls.json');
const REQUEST_DELAY_MS = 1200; // polite delay between page fetches
const MAX_URLS_PER_DOMAIN = 800;
const CHUNK_OPTIONS = { targetSize: 1000, maxSize: 1500, minSize: 200 };

const UA = 'Mozilla/5.0 (compatible; BotanicalAgent/1.0; +https://botanical-agent.vercel.app)';

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

interface DomainConfig {
  sitemaps?: string[];
  seeds?: string[];
  selector: string;
  isAllowedUrl: (url: string) => boolean;
}

// ─── Per-domain config: sitemaps to crawl + an ALLOWLIST of URL patterns ───────
// Allowlists (not denylists) are the default: a denylist fails open on anything
// the author didn't think of, which is exactly how search-result pages, tag
// archives, and grant-administration pages ended up indexed as content before.
// bara.co.il is the one deliberate exception (see its comment below).
const DOMAIN_SEEDS: Record<string, DomainConfig> = {
  'bara.co.il': {
    sitemaps: ['https://bara.co.il/sitemap_index.xml'],
    selector: '.entry-content, article, main, #content, .elementor-widget-theme-post-content',
    // Pragmatic exception to the allowlist rule: bara.co.il is a general WordPress
    // blog with flat, unstructured post slugs and no reliable "this is an article"
    // path prefix to allowlist against. A denylist of known non-content sections is
    // the practical choice here; the corpus-validate gate below still rejects thin
    // or corrupted pages that slip through this domain's looser filter.
    isAllowedUrl: (url) => {
      const p = new URL(url).pathname.toLowerCase();
      if (p === '/' || p === '') return false;
      const denied = [
        /\/cart\/?/, /\/checkout\/?/, /\/my-account\/?/, /\/wishlist\/?/, /\/shop\/?$/,
        /\/contact\/?/, /\/privacy\/?/, /\/terms\/?/, /\/404\/?/, /\/tag\//, /\/category\//,
        /\/author\//, /\/wp-admin\//, /\/feed\/?/, /\.(jpg|jpeg|png|gif|pdf|zip|mp4|mp3)$/,
        /\/page\/\d+\/?$/,
      ];
      return !denied.some((rx) => rx.test(p)) && !/[?&]s=/.test(url);
    },
  },
  'trifolium.co.il': {
    // sitemap_index.xml already contains every sub-sitemap (post/page/product/herbs/...);
    // listing the others too was pure redundant work in the old config.
    sitemaps: ['https://trifolium.co.il/sitemap_index.xml'],
    selector: '.entry-content, article, main, .blog-post-content, #content',
    isAllowedUrl: (url) => {
      const p = new URL(url).pathname.toLowerCase();
      if (!p.startsWith('/blog/')) return false;
      if (/\/blog\/(tag|category|page\/\d+)\//.test(p)) return false;
      if (p === '/blog/' || p === '/blog/herbs/') return false; // index/listing pages
      return true;
    },
  },
  'naturopedia.com': {
    sitemaps: [], // no usable sitemap; discovered via link-crawling with query strings preserved
    seeds: ['https://www.naturopedia.com/Index.asp'],
    selector: '.entry-content, article, main, .herb-content, #content, body',
    // The actual bug this domain exposed: naturopedia's real content lives in a query
    // string (pages.asp?rId=N), not the path, and the old crawler discarded query
    // strings before filtering — so it only ever picked up search.asp result pages.
    isAllowedUrl: (url) => {
      const parsed = new URL(url);
      const p = parsed.pathname.toLowerCase();
      const q = parsed.search.toLowerCase();
      if (/search\.asp/.test(p)) return false; // explicit deny: this was the actual corpus pollution
      if (/\/(pages|nutritionstudy)\.asp$/.test(p) && /[?&]rid=\d+/.test(q)) return true;
      return false;
    },
  },
  'medlineplus.gov': {
    sitemaps: ['https://medlineplus.gov/sitemap.xml'],
    selector: '#ency_summary, .page-details, article, main, #mplus-content',
    // /druginfo/herb_All.html (the old seed) links out to a separate proprietary
    // database, not in-domain herb pages. /ency/ is real, crawlable, NIH-authored
    // condition-encyclopedia content — general medical background, not herb-specific,
    // but genuinely useful and actually reachable.
    isAllowedUrl: (url) => {
      const p = new URL(url).pathname.toLowerCase();
      return p.startsWith('/ency/') && !p.startsWith('/spanish/') && p.endsWith('.htm');
    },
  },
  'nccih.nih.gov': {
    sitemaps: ['https://www.nccih.nih.gov/sitemap/sitemap-index.xml'], // old config pointed at /sitemap.xml, which 404s
    selector: '#main-content, .field-items, article, main',
    isAllowedUrl: (url) => {
      const parsed = new URL(url);
      const p = parsed.pathname.toLowerCase();
      if (!p.startsWith('/health/')) return false;
      const denyExact = [
        '/health/herblist-app',
        '/health/links-to-other-organizations',
        '/health/how-to-find-a-complementary-health-practitioner',
      ];
      return !denyExact.includes(p);
    },
  },
};

// ─── robots.txt ───────────────────────────────────────────────────────────────
const robotsCache = new Map<string, string[]>(); // hostname -> disallowed path prefixes for User-agent: *

async function getDisallowedPaths(hostname: string): Promise<string[]> {
  if (robotsCache.has(hostname)) return robotsCache.get(hostname)!;
  const disallowed: string[] = [];
  try {
    const res = await fetch(`https://${hostname}/robots.txt`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) });
    if (res.ok) {
      const text = await res.text();
      let applies = false;
      for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.split('#')[0].trim();
        if (!line) continue;
        const [key, ...rest] = line.split(':');
        const value = rest.join(':').trim();
        if (/^user-agent$/i.test(key)) applies = value === '*';
        else if (applies && /^disallow$/i.test(key) && value) disallowed.push(value);
      }
    }
  } catch (e) {
    console.warn(`  robots.txt fetch failed for ${hostname}, proceeding with no known restrictions: ${errMsg(e)}`);
  }
  robotsCache.set(hostname, disallowed);
  return disallowed;
}

async function isAllowedByRobots(url: string): Promise<boolean> {
  const parsed = new URL(url);
  const disallowed = await getDisallowedPaths(parsed.hostname);
  return !disallowed.some((prefix) => parsed.pathname.startsWith(prefix));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function sleep(ms: number) { return new Promise((r) => setTimeout(r, ms)); }

async function fetchTextRaw(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8', 'Accept-Language': 'he,en;q=0.8' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text(); // fine for XML sitemaps (always UTF-8 in practice); HTML pages use fetchAndDecode
}

// ─── Sitemap discovery ────────────────────────────────────────────────────────
async function discoverUrlsFromSitemap(sitemapUrl: string, depth = 0): Promise<string[]> {
  const urls: string[] = [];
  if (depth > 3) return urls; // guard against a pathological sitemap-of-sitemaps loop
  try {
    console.log(`  Fetching sitemap: ${sitemapUrl}`);
    const xml = await fetchTextRaw(sitemapUrl);
    const locs = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1].trim());
    const subSitemaps = locs.filter((u) => u.endsWith('.xml'));
    const pageUrls = locs.filter((u) => !u.endsWith('.xml'));

    if (subSitemaps.length > 0) {
      console.log(`  Found ${subSitemaps.length} sub-sitemap(s)`);
      for (const sub of subSitemaps) {
        try {
          urls.push(...(await discoverUrlsFromSitemap(sub, depth + 1)));
          await sleep(300);
        } catch (e) {
          console.warn(`  Failed sub-sitemap ${sub}: ${errMsg(e)}`);
        }
      }
    }
    urls.push(...pageUrls);
    console.log(`  Found ${pageUrls.length} page URL(s) directly in this sitemap`);
  } catch (e) {
    console.warn(`  Sitemap error for ${sitemapUrl}: ${errMsg(e)}`);
  }
  return urls;
}

// ─── Link crawler (for domains with no usable sitemap, e.g. naturopedia) ───────
// Query strings are preserved throughout — the old crawler stripped them before
// filtering, which is precisely why it could never reach naturopedia's articles.
async function crawlLinks(seedUrl: string, isAllowedUrl: (url: string) => boolean, maxPages = 2000): Promise<string[]> {
  const discovered = new Set<string>();
  const queue: string[] = [seedUrl];
  const visited = new Set<string>([seedUrl]);
  const domain = new URL(seedUrl).hostname;

  while (queue.length > 0 && discovered.size < maxPages) {
    const url = queue.shift()!;
    try {
      const html = await fetchTextRaw(url);
      const $ = cheerio.load(html);
      $('a[href]').each((_, el) => {
        try {
          const hrefAttr = $(el).attr('href');
          if (!hrefAttr) return;
          const href = new URL(hrefAttr, url).href.split('#')[0];
          if (new URL(href).hostname !== domain) return;
          if (visited.has(href)) return;
          visited.add(href);
          if (isAllowedUrl(href)) {
            discovered.add(href);
          } else {
            // Still worth crawling THROUGH a disallowed page (e.g. a listing page)
            // to reach allowed pages linked from it, as long as it's the same domain.
            queue.push(href);
          }
        } catch { /* malformed href, skip */ }
      });
      await sleep(400);
    } catch (e) {
      console.warn(`  Link crawl error for ${url}: ${errMsg(e)}`);
    }
  }
  return [...discovered];
}

// ─── Page scraper ─────────────────────────────────────────────────────────────
async function extractContent(url: string, selector: string): Promise<{ title: string; content: string }> {
  const html = await fetchAndDecode(url, {
    'User-Agent': UA,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'he,en;q=0.8',
  });
  const $ = cheerio.load(html);

  $('nav, footer, header, script, style, .sidebar, .menu, .comments, #comments, ' +
    '.wp-block-buttons, .sharedaddy, .related-posts, .widget, [class*="cookie"], ' +
    '[class*="banner"], [class*="popup"], [class*="modal"], [class*="newsletter"], ' +
    'figure > figcaption').remove();

  let content = '';
  const el = $(selector);
  if (el.length > 0) content = el.text();
  if (!content || content.length < 200) content = $('body').text();

  content = content.replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n').trim();

  const title = $('h1').first().text().trim()
    || $('title').text().split('|')[0].split('–')[0].split('-')[0].trim()
    || 'Botanical Document';

  return { title, content };
}

// ─── Ingest one chunk ─────────────────────────────────────────────────────────
async function ingestChunk(title: string, url: string, content: string) {
  const secret = process.env.INGESTION_SECRET;
  if (!secret) {
    throw new Error('INGESTION_SECRET env var is required to run the crawler (see /api/ingestion auth).');
  }
  const res = await fetch(INGESTION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-ingestion-secret': secret },
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
  console.log('Botanical Knowledge Crawler (rebuilt) - Starting\n');

  let ingestedUrls = new Set<string>();
  if (fs.existsSync(INGESTED_URLS_FILE)) {
    ingestedUrls = new Set(JSON.parse(fs.readFileSync(INGESTED_URLS_FILE, 'utf-8')));
    console.log(`Loaded ${ingestedUrls.size} already-ingested URLs\n`);
  }

  let totalNew = 0, totalChunks = 0, totalRejected = 0;

  for (const [domain, config] of Object.entries(DOMAIN_SEEDS)) {
    console.log(`\n${'='.repeat(60)}\nDomain: ${domain}\n${'='.repeat(60)}`);

    const discoveredUrls: string[] = [];
    for (const sitemap of config.sitemaps || []) {
      discoveredUrls.push(...(await discoverUrlsFromSitemap(sitemap)));
      await sleep(500);
    }

    if (discoveredUrls.length === 0 && config.seeds) {
      console.log('  No sitemap URLs, link-crawling from seed(s)...');
      for (const seed of config.seeds) {
        discoveredUrls.push(...(await crawlLinks(seed, config.isAllowedUrl, MAX_URLS_PER_DOMAIN)));
      }
    }

    const filteredUrls = [...new Set(discoveredUrls)]
      .filter((u) => { try { return config.isAllowedUrl(u); } catch { return false; } })
      .slice(0, MAX_URLS_PER_DOMAIN);

    const newUrls: string[] = [];
    for (const u of filteredUrls) {
      if (ingestedUrls.has(u)) continue;
      if (!(await isAllowedByRobots(u))) {
        console.log(`  Skipping (robots.txt disallows): ${u.slice(0, 90)}`);
        continue;
      }
      newUrls.push(u);
    }

    console.log(`  Discovered: ${filteredUrls.length} | New (not ingested, robots-allowed): ${newUrls.length}`);
    if (newUrls.length === 0) continue;

    for (let i = 0; i < newUrls.length; i++) {
      const url = newUrls[i];
      process.stdout.write(`  [${i + 1}/${newUrls.length}] ${url.slice(0, 80)} ... `);
      try {
        const { title, content } = await extractContent(url, config.selector);
        if (content.length < 300) {
          console.log(`too short (${content.length} chars), skipping`);
          continue;
        }

        const chunks = chunkText(content, CHUNK_OPTIONS);
        let accepted = 0, rejected = 0;
        for (let ci = 0; ci < chunks.length; ci++) {
          const chunkTitle = chunks.length > 1 ? `${title} (Part ${ci + 1}/${chunks.length})` : title;
          const candidate = { title: chunkTitle, url, content: chunks[ci] };
          const validation = validateChunk(candidate);
          if (!validation.valid) {
            rejected++;
            totalRejected++;
            continue;
          }
          try {
            await ingestChunk(candidate.title, candidate.url, candidate.content);
            accepted++;
            totalChunks++;
            await sleep(400);
          } catch (e) {
            console.error(`\n    Chunk ${ci + 1} ingestion failed: ${errMsg(e)}`);
          }
        }
        console.log(`${accepted} chunk(s) ingested, ${rejected} rejected by validation`);

        if (accepted > 0) {
          ingestedUrls.add(url);
          totalNew++;
          fs.writeFileSync(INGESTED_URLS_FILE, JSON.stringify([...ingestedUrls], null, 2));
        }
      } catch (e) {
        console.log(`FAILED: ${errMsg(e)}`);
      }
      await sleep(REQUEST_DELAY_MS);
    }
  }

  console.log(`\n${'='.repeat(60)}\nCRAWL COMPLETE`);
  console.log(`  New pages ingested : ${totalNew}`);
  console.log(`  New chunks created : ${totalChunks}`);
  console.log(`  Chunks rejected    : ${totalRejected}`);
  console.log(`  Total URLs tracked : ${ingestedUrls.size}`);
  console.log('='.repeat(60));
}

main().catch((err) => {
  console.error('\nFatal error:', err);
  process.exit(1);
});
