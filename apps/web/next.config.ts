import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // tesseract.js precisa ficar fora do bundle p/ o worker-script resolver (OCR).
  serverExternalPackages: ["postgres", "tesseract.js"],
  transpilePackages: ["@orbita/llm"],
  // Imagem Docker enxuta: empacota só o necessário (traça a raiz do monorepo pnpm).
  output: "standalone",
  outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
  // Tree-shaking de pacotes de barril no client → bundle menor / boot mais rápido.
  // NÃO incluir "better-auth" aqui: tem subpaths (better-auth/next-js) que o
  // otimizador quebra e faz a rota /api/auth/[...all] sumir (404 no login).
  experimental: {
    optimizePackageImports: ["react-markdown", "remark-gfm"],
  },
  // Headers de segurança seguros p/ o app (não mexem em mic/câmera/ws/data:).
  // CSP estrito e HSTS ficam de fora por ora: exigem mapear todas as conexões
  // (ollama, voz ws://:8001, AssemblyAI, data:/blob:) e HTTPS real — ver S1 no CHECKLIST.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-DNS-Prefetch-Control", value: "off" },
        ],
      },
    ];
  },
};

export default nextConfig;
