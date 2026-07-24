import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Lets phones/tablets on the same LAN load the dev server by IP (e.g. for
  // mobile testing). Next.js otherwise blocks dev-only asset/HMR requests
  // from any origin other than localhost. Dev-only setting — has no effect
  // in production (output: "standalone").
  allowedDevOrigins: ["192.168.1.*"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        ],
      },
    ];
  },
  serverExternalPackages: [
    "better-sqlite3",
    "@prisma/adapter-better-sqlite3",
    "@prisma/driver-adapter-utils",
    "exceljs",
  ],
};

export default nextConfig;
