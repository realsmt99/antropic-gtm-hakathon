import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  serverExternalPackages: ["fluent-ffmpeg", "pino", "pino-pretty"],
};

export default nextConfig;
