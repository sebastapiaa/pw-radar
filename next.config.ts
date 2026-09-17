import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Pin the workspace root to this folder. Without it Next walks up looking for
  // lockfiles and can pick a stray one in the user's home directory.
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
