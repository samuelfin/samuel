import type { NextConfig } from "next";

/**
 * Security headers that are the same for every request. The per-request
 * Content-Security-Policy is set in `proxy.ts`, which needs a fresh nonce.
 *
 * These are declared here rather than in the proxy so that they also cover the
 * static-asset paths the proxy's matcher skips.
 */
const securityHeaders = [
  // Two years, and submitted for preloading. Browsers ignore this over plain http,
  // so it is inert in local development.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  // Belt and braces with the CSP's `frame-ancestors 'none'`, for older browsers.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  // The terminal has no need to leak even an origin to third parties.
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  {
    key: "Permissions-Policy",
    value: "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  turbopack: {
    root: process.cwd(),
  },
  // The development indicator renders into a portal above everything else, and
  // at the top left it lands squarely on the terminal's brand mark. Moved rather
  // than disabled, because it still surfaces compile and runtime errors. This
  // affects `next dev` only; it is never present in a production build.
  devIndicators: {
    position: "bottom-right",
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
