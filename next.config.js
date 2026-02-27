/** @type {import('next').NextConfig} */
const nextConfig = {
  // Increase API response timeout for large sheets
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
};

module.exports = nextConfig;
