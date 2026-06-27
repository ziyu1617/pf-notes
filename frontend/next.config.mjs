/** @type {import('next').NextConfig} */
const isExport = process.env.NEXT_OUTPUT === 'export'

const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  ...(isExport
    ? { output: 'export' }
    : {
        async rewrites() {
          return [
            {
              source: '/api/:path*',
              destination: 'http://localhost:8000/api/:path*',
            },
            {
              source: '/uploads/:path*',
              destination: 'http://localhost:8000/uploads/:path*',
            },
          ]
        },
      }),
}

export default nextConfig
