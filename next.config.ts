import type { NextConfig } from "next";

const isGitHubPages = process.env.GITHUB_PAGES === "true";

const nextConfig: NextConfig = {
  // GitHub Pages serves this project from /SFs-/ rather than the domain root.
  output: "export",
  trailingSlash: true,
  ...(isGitHubPages ? { basePath: "/SFs-" } : {}),
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
