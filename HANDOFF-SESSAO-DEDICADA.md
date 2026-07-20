# Prompt — Sessão dedicada ÓRBITA (itens que exigem foco/verificação no device ou chaves)

> Cole isto como a mensagem inicial de uma nova sessão. Reúne tudo que ficou de fora
> das últimas sessões por ser arriscado sem verificação real, pesado, ou bloqueado por chave.

---

Continuo o ÓRBITA — assistente pessoal de IA local-first (voz "Ei Órbita"), em
`C:\Users\Users\Documents\github\orbita` (Windows/PowerShell, pt-BR).

REGRA DO PROJETO (inviolável): NADA de stubs; tudo verificado de verdade. A cada avanço,
atualize `orbita/CHECKLIST.md` e `C:\Users\Users\Documents\github\PRD-ORBITA.md`. Antes de
codar, leia esses dois + a memória (`orbita-projeto`). Repo é LOCAL (sem GitHub); não commite
sem eu pedir. Responda sempre em pt-BR.

Stack: monorepo pnpm/Turborepo, Next 16 (`apps/web`), Better Auth 1.6, Drizzle+pgvector,
AI SDK 7, Ollama (Qwen 2.5) + Claude Max via OAuth. Mobile: `apps/mobile` Expo SDK 54
(babel-preset-expo DEVE ser ~54.0.12). Voz: `apps/voice` (FastAPI :8001, faster-whisper `small`
+ Piper + wake Vosk). Rodar dev: `docker compose up -d db` (5433) · Ollama no host ·
`pnpm --filter @orbita/web db:migrate` · `pnpm --filter @orbita/web dev` (:3000). Produção
(muito mais rápido, sem GPU): `pnpm --filter @orbita/web prod`. Login teste:
`teste-conectores@orbita.local` / `senhateste123`.
⚠️ Máquina SEM GPU e pesada; screenshot do Browser pane TRAVA → usar Playwright headless
(`playwright-core` + Chrome `channel:'chrome'`, login via form). Bundle mobile: validar pedindo
o bundle ao Metro (manifesto: `curl -H "expo-platform: ios" localhost:8081/` → `launchAsset.url`).

## O que já está feito e verificado (NÃO refazer)
Bugs pt-BR/travessão/botão-parar/miniatura, failover cross-model + circuit breaker, headers de
segurança seguros, insights em CTE + cache, lazy-load de painéis, PromptComposer por tokens,
AssemblyAI Universal-3.5-Pro (chave no `.env`), login web redesenhado (Orb grande sem retângulo,
Google/GitHub/Magic Link), mobile UX foco-primeiro, trustedOrigins p/ LAN.

## TAREFAS DESTA SESSÃO (faça uma por vez, verificando de verdade)

### 1. C1 — SRP do `console.tsx` (extrair `useChatStream` + `useVoice`)  [precisa teste no device]
- Extrair de `apps/web/src/components/console.tsx` os hooks `useChatStream` (sendMessage/stream
  NDJSON/stats/elapsed/abort) e `useVoice` (speak/stopSpeaking/toggleWake/toggleMic/voiceCommand/
  seeScreen/sendAudioFile/toggleRealtime). Já existem `console/use-orb-mode.ts` e
  `console/use-conversations.ts` como padrão.
- ⚠️ RISCO: `sendMessage` é chamado pelo callback do wake-word → cuidado com stale-closure
  (já causou bugs de barge-in). Quebrar o ciclo chat↔voz via refs (`sendMessageRef`).
- ACEITE: `console.tsx` fica só render + wiring; typecheck limpo; e **testar no device/navegador**:
  enviar texto, parar resposta, wake word "Ei Órbita" → comando → resposta falada → re-arma escuta,
  barge-in interrompe. Sem regressão.

### 2. C2 — Design system  [verificável visualmente]
- `apps/web/src/components/ui/*`: `Button`, `Card`, `Field`, `Skeleton`, estados de erro/retry.
- Aplicar nos painéis (hoje cada um repete estilos inline). Verificar no navegador (Playwright).

### 3. R4 — Abrir o stream antes do RAG (TTFT)  [reestruturação]
- Hoje `/api/chat` faz `Promise.all(persona+tools+RAG)` ANTES do `streamText` (RAG entra no system).
- Alternativas: (a) RAG como TOOL que o modelo chama sob demanda (desacopla o TTFT); ou
  (b) responder já e injetar contexto só quando a query claramente precisa. Medir TTFT antes/depois.

### 4. V1 — Voz streaming  [precisa `apps/voice` rodando + device]
- STT parcial ao vivo + TTS em chunks + `silero-vad` (endpointing) no lugar do VAD por energia;
  reunião com buffer contínuo (hoje perde áudio entre janelas de 8s). Verificar com áudio real.

### 5. CSP / HSTS  [alto risco de quebrar — testar cada conexão]
- Adicionar CSP no `next.config.ts`/proxy mapeando TODAS as conexões: ollama (localhost:11434),
  voz `ws://localhost:8001`, AssemblyAI, FCM (push), `img-src data:`, `media-src blob:`, scripts do
  Next (nonce). HSTS só com HTTPS real. Testar chat/voz/push/imagem/tela sem quebrar.

### 6. B5 — Login mobile "e-mail/senha inválido"  [retomar diagnóstico]
- FATO: o celular envia a credencial CORRETA (hash `sha256(senhateste123)=33a5dc2f4c65` bate, email
  exato, `origin: null`) e o MESMO corpo via curl dá 200. Falta ver o STATUS/corpo da resposta ao
  celular. Re-inserir diagnóstico temporário em `apps/web/src/app/api/auth/[...all]/route.ts`
  (logar `resp.status` + corpo; NÃO logar senha) e comparar. Suspeitos: cookie de sessão velho no
  SecureStore, header, ou o `api()` do mobile. REMOVER o diagnóstico ao terminar.

## BLOQUEADOS por chave (fazer o código condicional a env, testar quando o Wesley plugar)
- **R1** RAG <1s: embedding de query em API de nuvem (Gemini `text-embedding-004` / OpenAI, 768d =
  bate com a coluna; re-embedar corpus). **R2** hybrid BM25+vetor (RRF) + rerank Cohere. **R5**
  pipeline OCR completo (Tesseract + fallback visão, dedup SHA-256, chunking tabular).
- **I1** OAuth Google/GitHub/Notion/Slack/WhatsApp + `RESEND_API_KEY` (magic link por email real).
- **I2** OAuth social NATIVO no mobile (deep-link p/ capturar a sessão no app; hoje abre o browser).

## Opcional — novas funcionalidades (pesquisa 2026, ver CHECKLIST §"NOVAS FUNCIONALIDADES")
Se sobrar tempo: briefing matinal falado, recall proativo de memória, workflows multi-passo,
screen awareness contínuo (opt-in), geração de documentos. Priorize as de maior alavanca
(proatividade + memória) e que NÃO precisam de chave.

Comece lendo CHECKLIST + PRD + memória, confirme o estado, e ataque as tarefas por ordem.
