const nextConfig = {
  output: 'standalone',
  serverExternalPackages: ['onnxruntime-node', '@xenova/transformers'],
  // Vercel's serverless bundler traces file dependencies independently of `output: standalone`
  // and can miss a large data file read via a runtime-computed path (fs.readFileSync +
  // path.join(process.cwd(), ...)) rather than a static import. Without this, chunks.json
  // (the entire BM25 corpus) silently isn't shipped to the deployed function — every keyword
  // search then returns zero results with no error anywhere.
  outputFileTracingIncludes: {
    '/api/chat': ['./lib/rag/chunks.json'],
    '/api/ingestion': ['./lib/rag/chunks.json'],
    '/api/debug': ['./lib/rag/chunks.json'],
  },
};

export default nextConfig;