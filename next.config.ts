import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Desktop builds use Next.js Output File Tracing so the server is portable
  // and can be shipped inside the Electron installer without running next build
  // on the user machine. Web/Vercel builds keep the normal .next output.
  output: process.env.DESKTOP_BUILD === "1" ? "standalone" : undefined,
};

export default nextConfig;
