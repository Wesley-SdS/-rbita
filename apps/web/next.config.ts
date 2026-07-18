import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ["postgres"],
  transpilePackages: ["@orbita/llm"],
};

export default nextConfig;
