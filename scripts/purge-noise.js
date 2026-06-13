// scripts/purge-noise.js
const fs = require('fs');
const path = require('path');

// Load environment variables from .env.local natively
const envFile = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envFile)) {
  const envContent = fs.readFileSync(envFile, 'utf-8');
  envContent.split('\n').forEach(line => {
    const match = line.match(/^\s*([\w.\-]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      const key = match[1];
      let value = match[2] || '';
      // Strip wrapping quotes
      if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
      if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
      process.env[key] = value;
    }
  });
}

const CHUNKS_FILE = path.join(__dirname, '..', 'lib', 'rag', 'chunks.json');
const INGESTED_URLS_FILE = path.join(__dirname, '..', 'data', 'ingested_urls.json');

const PINECONE_HOST = process.env.PINECONE_HOST;
const PINECONE_API_KEY = process.env.PINECONE_API_KEY;

function isAllowedUrl(url) {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace('www.', '').toLowerCase();
    const urlPath = parsed.pathname.toLowerCase();

    // Whitelisted Domains
    const allowedDomains = [
      'bara.co.il',
      'ajcn.nutrition.org',
      'nccih.nih.gov',
      'naturopedia.com',
      'medlineplus.gov',
      'trifolium.co.il'
    ];

    if (!allowedDomains.includes(host)) {
      return false;
    }

    // Strict path exclusions to filter out generic web clutter
    const excludedPatterns = [
      /\/cart\/?/i,
      /\/checkout\/?/i,
      /\/my-account\/?/i,
      /\/customer-login\/?/i,
      /\/affiliate-home\/?/i,
      /\/practitioners\/?/i,
      /\/registration\/?/i,
      /\/contact-us\/?/i,
      /\/privacy-policy\/?/i,
      /\/terms-of-use\/?/i,
      /\/our-vision\/?/i,
      /\/about-us\/?/i,
      /\/thank-you\/?/i,
      /\/thankyouforyourmessage\/?/i,
      /\/search-test\/?/i,
      /\/404\/?/i,
      /\/homepage\/?/i,
      /\/shop\/?/i,
    ];

    for (const pattern of excludedPatterns) {
      if (pattern.test(urlPath)) {
        return false;
      }
    }

    // Domain-specific directory constraints
    if (host === 'trifolium.co.il') {
      // Allow only specific blogs or the exact index page, excluding generic shop and corporate folders
      if (urlPath === '/' || urlPath === '' || urlPath === '/shop/' || urlPath.includes('/affiliate-home/')) {
        return false;
      }
    }

    if (host === 'bara.co.il') {
      // Exclude main landing, cart, and account hubs
      if (urlPath === '/' || urlPath === '' || urlPath.includes('/cart') || urlPath.includes('/my-account')) {
        return false;
      }
    }

    return true;
  } catch (error) {
    return false;
  }
}

async function purgeDatabase() {
  console.log('🧹 Starting RAG Database Purification...');

  if (!PINECONE_HOST || !PINECONE_API_KEY) {
    console.error('❌ Missing Pinecone credentials in .env.local.');
    process.exit(1);
  }

  // 1. Process chunks.json
  let chunks = [];
  if (fs.existsSync(CHUNKS_FILE)) {
    chunks = JSON.parse(fs.readFileSync(CHUNKS_FILE, 'utf-8'));
    console.log(`📦 Loaded ${chunks.length} chunks from chunks.json.`);
  }

  const allowedChunks = [];
  const purgedChunks = [];

  for (const chunk of chunks) {
    if (isAllowedUrl(chunk.url)) {
      allowedChunks.push(chunk);
    } else {
      purgedChunks.push(chunk);
    }
  }

  console.log(`🔍 whitelist filter results: ${allowedChunks.length} allowed, ${purgedChunks.length} to be purged.`);

  // 2. Delete purged chunks from Pinecone
  if (purgedChunks.length > 0) {
    console.log(`\n🗑️ Purging ${purgedChunks.length} vectors from Pinecone (with automatic retries)...`);
    for (let i = 0; i < purgedChunks.length; i++) {
      const chunk = purgedChunks[i];
      const id = chunk.id || Buffer.from(chunk.url + chunk.title).toString('base64').slice(0, 50);
      console.log(`[Purge ${i + 1}/${purgedChunks.length}] Deleting vector ID: ${id} | URL: ${chunk.url}`);

      let success = false;
      let attempts = 0;
      const maxAttempts = 3;

      while (!success && attempts < maxAttempts) {
        attempts++;
        try {
          const response = await fetch(`https://${PINECONE_HOST}/vectors/delete`, {
            method: 'POST',
            headers: {
              'Api-Key': PINECONE_API_KEY,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ ids: [id] }),
          });

          if (response.ok) {
            console.log(`✅ Successfully deleted from Pinecone index.`);
            success = true;
          } else {
            const errText = await response.text();
            console.error(`⚠️ Pinecone delete attempt ${attempts} failed: ${response.status} - ${errText}`);
            if (attempts < maxAttempts) {
              await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
            }
          }
        } catch (err) {
          console.error(`⚠️ Network/DNS error on attempt ${attempts} for ${id}:`, err.message);
          if (attempts < maxAttempts) {
            // Wait longer on network error to allow DNS resolution to recover
            await new Promise(resolve => setTimeout(resolve, 2000 * attempts));
          }
        }
      }

      if (!success) {
        console.error(`❌ Failed to delete vector ID: ${id} after ${maxAttempts} attempts.`);
      }

      // Small delay between deletes to respect API rate limits
      await new Promise(resolve => setTimeout(resolve, 300));
    }
  }

  // 3. Rewrite chunks.json
  fs.writeFileSync(CHUNKS_FILE, JSON.stringify(allowedChunks, null, 2), 'utf-8');
  console.log(`\n💾 Saved ${allowedChunks.length} clean botanical chunks to chunks.json.`);

  // 4. Process ingested_urls.json
  if (fs.existsSync(INGESTED_URLS_FILE)) {
    const urls = JSON.parse(fs.readFileSync(INGESTED_URLS_FILE, 'utf-8'));
    console.log(`\n📦 Loaded ${urls.length} URLs from ingested_urls.json.`);

    const allowedUrls = urls.filter(isAllowedUrl);
    fs.writeFileSync(INGESTED_URLS_FILE, JSON.stringify(allowedUrls, null, 2), 'utf-8');
    console.log(`💾 Saved ${allowedUrls.length} clean whitelisted URLs to ingested_urls.json (purged ${urls.length - allowedUrls.length} links).`);
  }

  console.log('\n🎉 DATABASE PURIFICATION COMPLETE! All non-botanical clutter has been purged.');
}

purgeDatabase().catch(err => {
  console.error('❌ Critical purge pipeline error:', err);
  process.exit(1);
});
