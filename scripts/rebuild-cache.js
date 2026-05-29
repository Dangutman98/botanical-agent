// scripts/rebuild-cache.js
const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');

const INGESTED_URLS_FILE = path.join(__dirname, '..', 'ingested_urls.json');
const CHUNKS_FILE = path.join(__dirname, '..', 'lib', 'rag', 'chunks.json');
const INGESTION_URL = 'http://127.0.0.1:3000/api/ingestion';

async function main() {
  console.log('🚀 Starting local chunk cache rebuild script...');

  if (!fs.existsSync(INGESTED_URLS_FILE)) {
    console.error(`❌ Ingested URLs file not found at ${INGESTED_URLS_FILE}. Please run crawl.js first.`);
    process.exit(1);
  }

  const ingestedUrls = JSON.parse(fs.readFileSync(INGESTED_URLS_FILE, 'utf-8'));
  console.log(`📦 Loaded ${ingestedUrls.length} URLs from ingested_urls.json.`);

  let localChunks = [];
  if (fs.existsSync(CHUNKS_FILE)) {
    localChunks = JSON.parse(fs.readFileSync(CHUNKS_FILE, 'utf-8'));
    console.log(`📦 Loaded ${localChunks.length} existing chunks from chunks.json.`);
  }

  // Find URLs that are in ingested_urls.json but NOT in chunks.json
  const existingUrls = new Set(localChunks.map(c => c.url));
  const missingUrls = ingestedUrls.filter(url => !existingUrls.has(url));

  console.log(`🎯 Found ${missingUrls.length} URLs that need to be scraped and cached locally.`);

  if (missingUrls.length === 0) {
    console.log('✅ Local cache is already fully synced! Nothing to do.');
    process.exit(0);
  }

  for (let i = 0; i < missingUrls.length; i++) {
    const url = missingUrls[i];
    console.log(`\n[Progress: ${i + 1}/${missingUrls.length}] 🕸️ Scraping: ${url}`);

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const html = await response.text();
      const $ = cheerio.load(html);

      // Strip non-content elements
      $('nav, footer, script, style, .header, .sidebar, .comments, #comments, .wp-block-buttons').remove();

      const title = $('title').text().split('|')[0].trim() || 'Botanical Document';
      let content = $('.entry-content, article, main, #content, .elementor-widget-theme-post-content').text().trim();
      if (!content) {
        content = $('body').text().trim();
      }

      content = content.replace(/\s+/g, ' ').slice(0, 5000);

      if (content.length < 300) {
        console.log(`⚠️ Content too short for "${title}" (${content.length} chars), skipping...`);
        continue;
      }

      console.log(`🧠 Ingesting local copy: "${title}" (${content.length} chars)`);

      const ingestResponse = await fetch(INGESTION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, url, content }),
      });

      if (ingestResponse.ok) {
        console.log('✅ Successfully indexed and cached local copy!');
      } else {
        console.error(`❌ Ingestion failed for "${title}": Status ${ingestResponse.status} - ${await ingestResponse.text()}`);
      }
    } catch (error) {
      console.error(`❌ Error parsing ${url}:`, error.message);
    }

    // Polite delay between requests to avoid rate limits
    await new Promise(resolve => setTimeout(resolve, 1500));
  }

  console.log('\n🎉 CACHE REBUILD COMPLETE! All missing chunks have been successfully cached.');
}

main().catch(err => {
  console.error('❌ Critical pipeline error:', err);
  process.exit(1);
});
