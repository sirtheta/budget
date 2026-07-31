import type { MetadataRoute } from "next";

/**
 * Web app manifest, so the app installs to a phone's home screen.
 *
 * This is a self-hosted household app that is mostly opened on a phone, on the
 * LAN, to check a balance or enter a booking at the till — the exact usage a
 * home-screen icon and a standalone window serve, and the exact usage that a
 * browser tab with a `192.168.x.x` URL serves badly.
 *
 * `display: standalone` rather than `fullscreen`: the app has no immersive
 * mode to justify hiding the status bar, and losing the clock and battery on a
 * phone is a poor trade for a few pixels.
 *
 * The manifest and its icons are exempted from the login redirect in proxy.ts.
 * A browser fetches them without credentials, and a 307 to /login would make
 * the app silently uninstallable.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Haushaltsbudget",
    // Shown under the home-screen icon, where roughly 12 characters survive.
    short_name: "Budget",
    description: "Budget-, Ausgaben- und Vermögensübersicht für den privaten Haushalt",
    lang: "de-CH",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    // Matches --background / --primary of the light theme in globals.css. The
    // manifest cannot follow the user's dark mode, so it commits to light —
    // getting it wrong the other way flashes white on a dark launch.
    background_color: "#fcfcfd",
    theme_color: "#2563eb",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      // Also declared maskable: Android crops these to its own icon shape, and
      // this icon survives that — the blue plate is full-bleed and the bars sit
      // inside the central 80% safe zone (6–26 of a 32-unit viewBox).
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
