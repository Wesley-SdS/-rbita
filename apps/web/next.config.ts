import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import { securityHeaders } from "./src/lib/security/headers";

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
    // CACHE DE ROTA NO CLIENTE (Router Cache). O padrão do Next desde a 15 é
    // `dynamic: 0`, ou seja, não guarda nada: voltar para uma tela vista há
    // três segundos refazia o servidor inteiro. Aqui toda tela é dinâmica (o
    // layout lê a sessão), então esse padrão valia para o app todo.
    //
    // 30s é curto de propósito: é o bastante para ir e voltar no menu sem
    // esperar, e curto demais para alguém ver dado de ontem. O que precisa ser
    // mais fresco que isso não vem do payload da rota, vem das rotas /api pelo
    // `useRecurso`, que tem TTL próprio e invalidação por tag.
    staleTimes: { dynamic: 30, static: 180 },
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
  // Cabeçalhos de segurança, com CSP e HSTS (ver security-headers.ts para o
  // mapa do que o navegador acessa fora da própria origem)
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders(process.env, process.env.NODE_ENV !== "production") }];
  },
};

export default nextConfig;
