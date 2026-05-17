
const nextConfig = {
  output: 'standalone',
  experimental: {
    serverExternalPackages: ['onnxruntime-node', '@xenova/transformers'],
  },
};

export default nextConfig;
