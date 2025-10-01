/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [{ source: '/:path*', destination: '/index.html' }];
  },
};
export default nextConfig;