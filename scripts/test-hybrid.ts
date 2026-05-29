// scripts/test-hybrid.ts
import { queryHybridBotanicalKnowledge } from '../lib/rag/hybrid-store';

async function runTest() {
  const query = 'שורש אסטרגלוס לחיזוק מערכת החיסון';
  console.log(`🔍 Running Hybrid Retrieval Test for query: "${query}"...\n`);

  try {
    const results = await queryHybridBotanicalKnowledge(query, 3);
    
    console.log(`🏆 Top ${results.length} Fused Results (Semantic + Keyword):\n`);
    results.forEach((doc, idx) => {
      console.log(`[Rank ${idx + 1}] Title: ${doc.title}`);
      console.log(`URL: ${doc.url}`);
      console.log(`Content Snippet: ${doc.content.slice(0, 300)}...\n`);
      console.log('--------------------------------------------------\n');
    });
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

runTest();
