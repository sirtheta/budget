import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Prevent clients from silently using assets/Server Actions from a
  // previous deployment during rolling updates. Baked in at image build
  // time via the Dockerfile's DEPLOYMENT_ID build arg (see release.yml) —
  // this value is frozen into .next/standalone/server.js at `npm run
  // build`, so setting it as a *runtime* env var has no effect.
  deploymentId: process.env.DEPLOYMENT_ID || undefined,
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
  experimental: {
    // Same ceiling as readUpload() (CAMT.053-/CSV-/PDF-Datei) plus 1 MB for the
    // multipart overhead. Derived from IMPORT_MAX_FILE_SIZE_BYTES at build time:
    // the standalone output freezes this config, so in the Docker image a value
    // above 10 MB only takes effect after a rebuild.
    serverActions: {
      bodySizeLimit: `${Math.ceil((Number(process.env.IMPORT_MAX_FILE_SIZE_BYTES) || 10 * 1024 * 1024) / 1024 / 1024) + 1}mb`,
    },
  },
  serverExternalPackages: [
    "better-sqlite3",
    "@prisma/adapter-better-sqlite3",
    "@prisma/driver-adapter-utils",
  ],
};

export default nextConfig;
