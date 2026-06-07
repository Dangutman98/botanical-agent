export async function GET() {
  const results: Record<string, unknown> = {};

  // 1. Check env vars presence (masked)
  const groqKey = process.env.GROQ_API_KEY || '';
  const pineconeKey = process.env.PINECONE_API_KEY || '';
  const pineconeHost = process.env.PINECONE_HOST || '';

  results['env'] = {
    GROQ_API_KEY: groqKey ? `✅ present (${groqKey.slice(0, 8)}...)` : '❌ MISSING',
    PINECONE_API_KEY: pineconeKey ? `✅ present (${pineconeKey.slice(0, 8)}...)` : '❌ MISSING',
    PINECONE_HOST: pineconeHost ? `✅ ${pineconeHost}` : '❌ MISSING',
  };

  // 2. Test Groq API key
  try {
    const groqRes = await fetch('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: `Bearer ${groqKey}` },
    });
    const groqData = await groqRes.json();
    results['groq'] = groqRes.ok
      ? `✅ OK (${groqData.data?.length ?? 0} models available)`
      : `❌ ${groqRes.status} - ${JSON.stringify(groqData)}`;
  } catch (e: any) {
    results['groq'] = `❌ Network error: ${e.message}`;
  }

  // 3. Test Pinecone
  try {
    const pineconeRes = await fetch(`https://${pineconeHost}/describe_index_stats`, {
      method: 'POST',
      headers: {
        'Api-Key': pineconeKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });
    const pineconeData = await pineconeRes.json();
    results['pinecone'] = pineconeRes.ok
      ? `✅ OK - ${JSON.stringify(pineconeData)}`
      : `❌ ${pineconeRes.status} - ${JSON.stringify(pineconeData)}`;
  } catch (e: any) {
    results['pinecone'] = `❌ Network error: ${e.message}`;
  }

  return Response.json(results, { status: 200 });
}
