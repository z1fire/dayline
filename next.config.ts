import type { NextConfig } from "next";

const isPagesBuild = process.env.BUILD_TARGET === "pages";
const basePath = isPagesBuild ? process.env.NEXT_PUBLIC_BASE_PATH || "" : "";

const nextConfig: NextConfig = {
  output: isPagesBuild ? "export" : undefined,
  basePath,
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
