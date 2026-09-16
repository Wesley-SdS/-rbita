import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

/**
 * O que NÃO vai para o apps/api: lookahead negativo usado em `rewrites`.
 * Tudo o mais em /api/* já mora no NestJS (migração da Onda 1 concluída).
 */
const API_KEPT_IN_NEXT = "(?!auth(?:/|$)|connectors/[^/]+/callback(?:/|$))";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // tesseract.js precisa ficar fora do bundle p/ o worker-script resolver (OCR).
  serverExternalPackages: ["postgres", "tesseract.js"],
  transpilePackages: ["@orbita/llm", "@orbita/db", "@orbita/core"],
  // Imagem Docker enxuta: empacota só o necessário (traça a raiz do monorepo pnpm).
  output: "standalone",
  outputFileTracingRoot: fileURLToPath(new URL("../..", import.meta.url)),
  // Tree-shaking de pacotes de barril no client → bundle menor / boot mais rápido.
  // NÃO incluir "better-auth" aqui: tem subpaths (better-auth/next-js) que o
  // otimizador quebra e faz a rota /api/auth/[...all] sumir (404 no login).
  experimental: {
    optimizePackageImports: ["react-markdown", "remark-gfm"],
  },
  // ORIGEM ÚNICA (Onda 1): TODO /api/* vai para o apps/api (NestJS), exceto o
  // que fica no Next de propósito: /api/auth/* (Better Auth) e o callback OAuth
  // /api/connectors/:provider/callback (o provedor redireciona para cá).
  //
  // Por que `beforeFiles` com regex e não `fallback`: verificado no Next 16.2
  // (Turbopack) que um rewrite `fallback` em /api/:path* passa a responder 404
  // para as próprias rotas do app router. Em produção o Caddy faz este papel.
  async rewrites() {
    const api = process.env.API_URL ?? "http://127.0.0.1:3010";
    return {
      beforeFiles: [{ source: `/api/:path(${API_KEPT_IN_NEXT}.*)`, destination: `${api}/api/:path` }],
    };
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
