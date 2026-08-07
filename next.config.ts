import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.programmable.market" }],
        destination: "https://programmable.market/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
