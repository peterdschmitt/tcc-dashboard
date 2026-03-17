/** @type {import('next').NextConfig} */
const nextConfig = {
  // Increase body size limit for commission statement PDF uploads
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
    // Next.js 14: exclude pdf-parse and pdfjs-dist from webpack bundling
    serverComponentsExternalPackages: ['pdf-parse', 'pdfjs-dist'],
  },
};

module.exports = nextConfig;
