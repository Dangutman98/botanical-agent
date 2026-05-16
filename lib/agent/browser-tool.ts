export interface BrowseResult {
  url: string;
  title: string;
  content: string;
}

export async function browseBotanicalSites(query: string, _groqApiKey?: string): Promise<BrowseResult[]> {
  console.info(`[browser-tool] 1. Initiating Jina AI Search for keyword: "${query}"`);
  const results: BrowseResult[] = [];
  
  const searchQuery = `site:bara.co.il OR site:naturopedia.com OR site:trifolium.co.il OR site:ajcn.nutrition.org OR site:nccih.nih.gov OR site:medlineplus.gov ${query}`;
  console.info(`[browser-tool] 2. Exact Search Query: "${searchQuery}"`);
  
  try {
    const urlToFetch = `https://s.jina.ai/${encodeURIComponent(searchQuery)}`;
    console.info(`[browser-tool] 3. Fetching URL: ${urlToFetch}`);

 const response = await fetch(urlToFetch, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${process.env.JINA_API_KEY}` // <--- זו השורה שמושכת את המפתח מהכספת של AWS!
      }
    });

    console.info(`[browser-tool] 4. Response Status: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      console.error('[browser-tool] ERROR: Jina API returned an error:', response.statusText);
      return results;
    }

    const data = await response.json();
    
    // מדפיסים את ההתחלה של התשובה כדי לא לפוצץ את הלוג, אבל לראות אם חזר משהו
    console.info(`[browser-tool] 5. Raw Jina API Response preview:`, JSON.stringify(data).substring(0, 300) + '...');
    
    if (data && data.data && Array.isArray(data.data)) {
      console.info(`[browser-tool] 6. Number of items found by Jina: ${data.data.length}`);
      
      if (data.data.length === 0) {
         console.warn(`[browser-tool] WARNING: Jina returned an empty array! The search engine found nothing.`);
      }

      for (const [index, item] of data.data.entries()) {
        // Stop if we already have 6 good results
        if (results.length >= 6) break;

        console.info(`[browser-tool] 7. Inspecting item ${index + 1}: URL=${item.url}`);
        
        // DEVOPS FIX: The URL Blacklist (Skip commercial pages)
        const isCommercial = ['/shop/', '/category/', '/product/', 'add-to-cart', '?v='].some(badWord => item.url.toLowerCase().includes(badWord));
        
        if (isCommercial) {
          console.warn(`[browser-tool] WARNING: Skipped commercial URL: ${item.url}`);
          continue; 
        }

        if (item.content && item.content.length > 50) {
          results.push({
            url: item.url,
            title: item.title,
            content: item.content.slice(0, 1500) 
          });
          console.info(`[browser-tool] 8. Successfully added medical content from: ${item.url}`);
        }
      }
    } else {
      console.warn(`[browser-tool] WARNING: data.data is missing or not an array.`, data);
    }
  } catch (error) {
    console.error('[browser-tool] FATAL ERROR connecting to Jina AI:', error);
  }

  console.info(`[browser-tool] 9. Final results array length: ${results.length}`);
  return results;
}