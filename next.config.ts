import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  /**
   * Local dev only — lets the ngrok tunnel used to expose this dev server for
   * the Facebook OAuth callback also load the app's own JS/HMR assets.
   * Without this, Next.js's dev-mode origin check 403s every `_next/static`
   * request from that origin, so the page renders but never hydrates.
   */
  allowedDevOrigins: ["driver-wing-diaper.ngrok-free.dev"],
};

export default nextConfig;
