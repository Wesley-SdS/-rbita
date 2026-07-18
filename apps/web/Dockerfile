# syntax=docker/dockerfile:1
# ÓRBITA — web (Next.js 16, output standalone) num monorepo pnpm.
# Build a partir da RAIZ do repo:  docker build -f apps/web/Dockerfile .

FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

# ---- deps: instala o workspace inteiro (cacheável) ----
FROM base AS deps
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/llm/package.json packages/llm/package.json
COPY apps/web/package.json apps/web/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

# ---- builder: compila o Next ----
FROM base AS builder
WORKDIR /repo
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=deps /repo/apps/web/node_modules ./apps/web/node_modules
COPY --from=deps /repo/packages/llm/node_modules ./packages/llm/node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @orbita/web build

# ---- runner: imagem final mínima ----
FROM node:22-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
RUN groupadd -g 1001 nodejs && useradd -u 1001 -g nodejs -m nextjs

# standalone traz o server + node_modules mínimos; static e public à parte
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/public ./apps/web/public
# tesseract.js é serverExternalPackage: o worker é require dinâmico (não traçável),
# então copiamos o pacote explicitamente para o OCR funcionar no standalone.
COPY --from=builder --chown=nextjs:nodejs /repo/node_modules/.pnpm/tesseract.js@7.0.0 ./apps/web/node_modules/.pnpm/tesseract.js@7.0.0
COPY --from=builder --chown=nextjs:nodejs /repo/apps/web/node_modules/tesseract.js ./apps/web/node_modules/tesseract.js

USER nextjs
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
