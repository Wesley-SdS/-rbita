# ÓRBITA — Checklist de Desenvolvimento

> Fonte da verdade do progresso. Atualizado a cada passo. Sem stubs — só código real e funcionando.
> Legenda: `[ ]` a fazer · `[~]` em andamento · `[x]` feito e verificado

---

## Fase 0 — Fundação do monorepo ✅
- [x] `0.1` Estrutura do monorepo (pnpm workspaces + Turborepo 2.10)
- [x] `0.2` `docker-compose.yml` com Postgres + pgvector (porta 5433, healthy)
- [x] `0.3` `apps/web` — Next.js 16.2.10 (App Router, React 19.2, TS strict) bootando
- [x] `0.4` Tailwind v4 + design tokens (paleta ÓRBITA dourada)
- [x] `0.5` Drizzle ORM 0.45 + conexão Postgres + primeira migration (`meta`)
- [x] `0.6` `/api/health` real (checa DB) → `{"status":"ok","db":"up"}`
- [x] `0.7` Git init + primeiro commit (`5456f85`)

## Fase 1 — Auth (Better Auth) ✅
- [x] `1.1` Better Auth 1.6.23 configurado (adapter Drizzle)
- [x] `1.2` Schema de auth (user/session/account/verification) + migration
- [x] `1.3` Rota `/api/auth/[...all]` + auth-client + getSession
- [x] `1.4` Email/senha funcionando (signup/login/logout) — **verificado e2e**
- [~] `1.5` Login social Google — **wired** (condicional, atrás de env); falta testar c/ credenciais reais
- [x] `1.6` Página protegida `/app` (redirect via server session)

## Fase 2 — Provider layer (Local / Gateway / Claude Max) ✅
- [x] `2.1` `packages/llm` — registry de modelos + resolver
- [x] `2.2` Adaptador **Local** (Ollama/Qwen 2.5) — **verificado** (streaming real)
- [x] `2.3` Adaptador **Vercel AI Gateway** (BYOK) — real, oculto até `AI_GATEWAY_API_KEY`
- [x] `2.4` Adaptador **Claude Max** (OAuth token) — real, oculto até `CLAUDE_CODE_OAUTH_TOKEN`
- [x] `2.5` Catálogo de modelos (label, tier, billing, custo)
- [x] `2.6` Auto-router (complexidade: local→Max→Gateway) + fallback pro local — **verificado**
- [x] `2.7` `/api/chat` streaming (AI SDK 7) autenticado + persistência _(tool-calling entra na Fase 6 c/ conectores)_

## Fase 3 — UI do app + Orb
- [ ] `3.1` Layout do app (rails, stage, composer) — do protótipo
- [ ] `3.2` Componente **Orb** (núcleo neural Jarvis) portado + estados
- [ ] `3.3` Seletor de provider/modelo ligado ao backend
- [ ] `3.4` Chat com streaming + histórico (persistido no DB)
- [ ] `3.5` Painel de sessão/energia/custo real (tokens/latência)
- [ ] `3.6` Visualização de atividade (tool steps)

## Fase 4 — Memória & RAG (Vektus)
- [ ] `4.1` Schema de memória + pgvector (embeddings)
- [ ] `4.2` Ingestão de documentos + chunking (portado do Vektus)
- [ ] `4.3` OCR (portado do Vektus)
- [ ] `4.4` Busca semântica + citações no chat
- [ ] `4.5` Memória de longo prazo (fatos/preferências) + "esquece isso"

## Fase 5 — Voz
- [ ] `5.1` `apps/voice` (serviço Python): STT faster-whisper
- [ ] `5.2` TTS local humanizado (CosyVoice2/XTTS) + fallback nuvem
- [ ] `5.3` Wake word "Ei Órbita" (openWakeWord)
- [ ] `5.4` Pipeline de voz (STT→LLM→TTS) + barge-in
- [ ] `5.5` Integração da voz com o Orb (estados reagindo à fala)

## Fase 6 — Conectores (NexConnect)
- [ ] `6.1` Hub MCP + contrato de conector
- [ ] `6.2` Gmail (OAuth + ler/enviar com confirmação)
- [ ] `6.3` Google Calendar (criar/listar eventos)
- [ ] `6.4` Notion · `6.5` Slack · `6.6` WhatsApp

## Fase 7 — Proatividade, finanças, mobile
- [ ] `7.1` Agendador (BullMQ/Redis) + pulse proativo
- [ ] `7.2` Skill de finanças (OrbitFinance)
- [ ] `7.3` App mobile (Expo)

## Fase 8 — Polish & lançamento
- [ ] `8.1` `docker compose up` sobe tudo (app containerizado)
- [ ] `8.2` LGPD (consentimento, cofre de credenciais, apagar dados)
- [ ] `8.3` Testes (Vitest) + CI
- [ ] `8.4` Observabilidade + docs + onboarding <5min

---

### Log de progresso
- _2026-07-18_ — checklist criado; ambiente validado (Node 22, pnpm 11, Docker 29, Ollama+Qwen2.5).
- _2026-07-18_ — **Fase 0 concluída**: monorepo + Next 16.2.10 + Postgres/pgvector (Docker) + Drizzle migration + `/api/health` OK + home renderizando (verificado por headless). Versões confirmadas: Next 16.2.10, Better Auth 1.6.23, AI SDK 7.0.31, React 19.2, Drizzle 0.45. Commit `5456f85`.
- _2026-07-18_ — **Fase 1 concluída**: Better Auth 1.6.23 (email/senha) + sessões + `/app` protegida. Verificado e2e (signup pela UI → /app; usuário persistido no Postgres). Google OAuth wired (atrás de env). Commit `b81f217`.
- _2026-07-18_ — **Fase 2 concluída**: `packages/llm` (Local/Gateway/Claude Max) + auto-router + `/api/chat` streaming + UI de chat. Verificado e2e: chat real com **Qwen 2.5 local**, streaming ao vivo, persistido no Postgres. Commit `b7c8de4`.
- **Próximo:** Fase 3 — UI do app completa (layout do protótipo) + **Orb (núcleo neural Jarvis)** + painel de sessão/energia/custo.
