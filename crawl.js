// crawl.js
const cheerio = require('cheerio');
const fs = require('fs');

const INGESTION_URL = "http://127.0.0.1:3000/api/ingestion";
const CACHE_FILE = './ingested_urls.json'; 

// 1. מפות האתר - הרחבנו לעמודי מוצרים, דפים ופוסטים
const SITEMAPS = [
    "https://bara.co.il/post-sitemap.xml",
    "https://bara.co.il/page-sitemap.xml",
    "https://bara.co.il/product-sitemap.xml",
    "https://trifolium.co.il/page-sitemap.xml",
    "https://www.naturopedia.com/sitemap_index.xml",
    "https://www.naturopedia.com/page-sitemap.xml"
];

// 2. לינקים ישירים למאגרים אמריקאים קליניים
const DIRECT_URLS = [
    "https://www.nccih.nih.gov/health/ginger",
    "https://medlineplus.gov/druginfo/natural/961.html",
    "https://www.nccih.nih.gov/health/turmeric"
];

// טעינת הזיכרון מקובץ (כדי לדלג על מה שכבר נמצא ב-Pinecone)
let ingestedCache = [];
if (fs.existsSync(CACHE_FILE)) {
    ingestedCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'));
    console.log(`📦 Loaded ${ingestedCache.length} previously ingested URLs from cache.`);
}

// פונקציית הפטיש: שואבת קישורים בכוח עם Regex ומתחפשת לדפדפן
async function fetchUrlsFromSitemap(sitemapUrl) {
    try {
        console.log(`\n🗺️ Reading Sitemap: ${sitemapUrl}`);
        const response = await fetch(sitemapUrl, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8"
            }
        });
        
        const xml = await response.text();
        
        const regex = /<loc>(.*?)<\/loc>/g;
        let urls = [];
        let match;
        
        while ((match = regex.exec(xml)) !== null) {
            urls.push(match[1]);
        }
        
        if (urls.length === 0) {
            console.log(`⚠️ No URLs found in ${sitemapUrl}. Site might be blocking us or sitemap is empty.`);
        }
        
        // סינון לינקים שלא קשורים לתוכן (תמונות, קטגוריות)
        return urls.filter(url => {
            return !url.includes('/category/') && 
                   !url.includes('/tag/') && 
                   !url.match(/\.(jpg|jpeg|png|gif|pdf)$/i);
        });
    } catch (error) {
        console.error(`❌ Failed to fetch sitemap ${sitemapUrl}:`, error.message);
        return [];
    }
}

// גירוד התוכן מתוך המאמר עצמו ושיגור למערכת המקומית
async function scrapeAndIngest(url) {
    try {
        console.log(`\n🕸️ Scraping: ${url}`);
        // מוסיפים User-Agent גם כאן כדי שלא יחסמו אותנו בקריאת המאמרים
        const response = await fetch(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            }
        });
        
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        
        const html = await response.text();
        const $ = cheerio.load(html);

        $('nav, footer, script, style, .header, .sidebar, .comments, #comments, .wp-block-buttons').remove();

        const title = $('title').text().split('|')[0].trim() || 'Botanical Document';
        let content = $('.entry-content, article, main, #content, .elementor-widget-theme-post-content').text().trim();
        if (!content) {
            content = $('body').text().trim(); 
        }

        content = content.replace(/\s+/g, ' ').slice(0, 5000); 

        if (content.length < 300) {
            console.log(`⚠️ Content too short for "${title}", skipping...`);
            return false;
        }

        console.log(`🧠 Chunking & Embedding: "${title}" (${content.length} chars)`);
        const ingestResponse = await fetch(INGESTION_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title, url, content })
        });

        if (ingestResponse.ok) {
            console.log(`✅ Successfully indexed inside Pinecone!`);
            return true; 
        } else {
            console.error(`❌ Ingestion failed for "${title}"`);
            return false;
        }

    } catch (error) {
        console.error(`❌ Error parsing ${url}:`, error.message);
        return false;
    }
}

async function mainPipeline() {
    console.log("🚀 Starting Global Botanical Knowledge Ingestion pipeline...");
    
    let allTargetUrls = [...DIRECT_URLS];
    
    // שואב את הכל בלי הגבלות
    for (const sitemap of SITEMAPS) {
        const urls = await fetchUrlsFromSitemap(sitemap);
        allTargetUrls = allTargetUrls.concat(urls); 
    }
    
    allTargetUrls = [...new Set(allTargetUrls)];
    console.log(`\n🎯 Found a total of ${allTargetUrls.length} unique articles to process.`);
    
    for (let i = 0; i < allTargetUrls.length; i++) {
        const currentUrl = allTargetUrls[i];
        
        // מנגנון הזיכרון: מדלג על מה שכבר קיים!
        if (ingestedCache.includes(currentUrl)) {
            console.log(`⏭️ [Progress: ${i + 1}/${allTargetUrls.length}] Skipping (Already in DB): ${currentUrl}`);
            continue; 
        }

        console.log(`\n[Progress: ${i + 1}/${allTargetUrls.length}]`);
        const success = await scrapeAndIngest(currentUrl);
        
        // אם ההזרקה הצליחה, מוסיפים לזיכרון
        if (success) {
            ingestedCache.push(currentUrl);
            fs.writeFileSync(CACHE_FILE, JSON.stringify(ingestedCache, null, 2));
        }
        
        // השהייה למניעת חסימות
        await new Promise(resolve => setTimeout(resolve, 1500));
    }
    
    console.log("\n🎉 PARSING COMPLETE! All databases have been successfully ingested.");
}

mainPipeline();