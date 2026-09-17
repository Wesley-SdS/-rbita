# BRIEFING — ÓRBITA → JARVIS RESIDENCIAL

> Documento de handoff para uma sessão nova, sem contexto prévio.
> Tudo aqui foi **verificado no código** em 2026-09-15/16, não estimado.
> Onde está escrito "não existe", significa que foi feito `grep` e voltou vazio.

---

## 1. MISSÃO

Transformar a **Órbita** (assistente pessoal de IA já funcional) no cérebro de um assistente
residencial estilo Jarvis, rodando **24/7 numa máquina Linux dentro de casa**.

O Home Assistant é **uma ferramenta** do assistente, não o cérebro. A Órbita orquestra.

---

## 2. PRINCÍPIO FUNDADOR (inegociável)

**A Órbita é um assistente pessoal de UM dono. Não é SaaS, não é multi-tenant, não será revendida.**

Existe um segundo projeto local, `../adalink-platform`, que é um SaaS multi-tenant em NestJS do
mesmo dono. Parte do código de lá será reaproveitado. **Barrar na porta** tudo que for de
plataforma: `organizationId`, billing, credits, marketplace, policy por organização, escala
horizontal.

Distinção que importa: **"pessoas da casa" não é multi-tenancy.** Permissão por pessoa e por
cômodo (a criança não destranca a porta) continua no escopo. Tenant, não.

### Foco declarado pelo dono, nesta ordem

1. **Rotina conturbada, cheia de reuniões** — a dor nº 1
2. **Automação e gerenciamento da casa**
3. **Finanças**
4. **Canais de comunicação** (Gmail, WhatsApp, Slack, **Teams**)

Mais três capacidades pedidas explicitamente:

5. **Câmeras** — ver o que está acontecendo, narrar em tempo real, reconhecer gestos e
   movimentos, servir de segurança
6. **Voz realtime de verdade** — conversa contínua, não turno a turno
7. **Reuniões com transcrição e separação de vozes** (Teams / Meet / Slack)

---

## 2.1 SEGUNDO PRINCÍPIO: ZERO HARDCODE (inegociável)

**A aplicação não tem limitação nem configuração fixa no código. Tudo é configurado e ajustado
pelo front.**

Não existe "quantos cômodos", "quais dispositivos", "quais modelos", "quais limites". Se é uma
decisão do dono, ela mora no banco e tem tela. Se é uma constante de engenharia, ela tem default
sensato **e** é sobrescrevível sem recompilar.

O teste mental: *"se o Wesley quiser mudar isso amanhã, ele precisa de um dev?"* Se sim, está errado.

### Inventário do que HOJE está hardcoded e precisa sair (verificado no código)

| Onde | O que está fixo | Vira |
|---|---|---|
| ~~`packages/llm/src/catalog.ts`~~ | ~~Array literal com 17 modelos~~ | ✅ **FEITO** — `packages/llm/src/discovery.ts` descobre nos provedores |
| `packages/llm/src/catalog.ts` | `classificarComplexidade` — regex | Regras de roteamento editáveis (Onda 1) |
| `lib/connectors/registry.ts` | `DEFS` com 3 conectores e seus escopos | Registro de conectores no banco |
| `api/chat/route.ts` | `HISTORY_WINDOW = 24` | Config de contexto |
| `api/chat/route.ts` | `OUT_CAP` (1024/2048/4096) | Por modelo, no catálogo |
| `api/chat/route.ts` | `RAG_TIMEOUT = 3500`, `stepCountIs(5)`, `maxRetries: 2` | Config do motor |
| `api/chat/route.ts` | `rateLimit(30, 60_000)` | Config de limites |
| `lib/chat/compose.ts` | `budgetTokens = 3200` e as prioridades (130/120/90/70/50) | Config do prompt |
| `lib/rag/retrieve.ts` | `CHUNK_MIN_SIM 0.35`, `MEM_MIN_SIM 0.4`, cache 60s/200 | Config do RAG |
| `lib/rag/chunk.ts` | `size 1000`, `overlap 150` | Config de indexação |
| `lib/chat/tools.ts` | Dedup de memória `0.92`, esquecer `0.4` | Config da memória |
| `packages/llm/src/failover.ts` | `CB_THRESHOLD 3`, `CB_COOLDOWN_MS 30_000` | Config de resiliência |
| `lib/voice/engine.ts` | `PRIMEIRO_CH 45`, `MIN_CH 80`, `MAX_CH 200` | Config de fala |
| `lib/voice/engine.ts` | VAD `rms > 0.02`, `silenceMs 1200`, `maxMs 12000` | Config de escuta |
| `api/knowledge/graph` | `LIMIT 60`, `sim > 0.55`, `LIMIT 150` | Config do grafo |
| `api/stt/route.ts` | `MAX_BYTES` 120MB | Config de upload |
| `api/meeting/summarize` | `MAX_PROMPT_CHARS` 100k | Config do resumo |
| `.env` | Wake word, vozes de TTS, modelo de visão, STT | Migrar para config com UI (env vira só o bootstrap) |

### Modelos: como ficou (referência do padrão a seguir nas outras áreas)

`packages/llm/src/discovery.ts` **pergunta a cada provedor** o que ele oferece, em vez de manter lista:

| Provedor | Fonte | O que vem |
|---|---|---|
| Ollama | `GET /api/tags` | modelos instalados, com parâmetros, contexto e se suportam tools/visão |
| Anthropic (assinatura Max) | `GET /v1/models` + Bearer OAuth | **exatamente os modelos liberados na conta do dono** (11 hoje) |
| Vercel AI Gateway | `getAvailableModels()` | catálogo completo **com preço por token** |
| Groq · Gemini · OpenAI · Cohere | `GET /v1/models` | tudo que a chave dá acesso |

Verificado em 2026-09-16: **45 modelos** (5 locais + 40 de nuvem), sem uma linha de catálogo.
Instalar um modelo (`ollama pull`) ou ligar uma chave faz ele aparecer sozinho.

Regras que valem para qualquer descoberta futura (câmeras, entidades do HA, canais):
- **deny-list, nunca allow-list** — modelo/dispositivo novo entra sozinho; só o que sabidamente
  não serve é nomeado
- **derivar, não tabelar** — porte sai de parâmetros ou preço; "mais novo" sai dos números do
  próprio id (`versaoDe`), nunca de uma tabela que envelhece
- **cache curto com invalidação explícita** (`POST /api/models` força nova descoberta)
- **o que for derivado fica marcado** (`tierDerived`) para a config poder sobrescrever

### O que NUNCA pode ser hardcoded (coisas que ainda nem existem)

Cômodos · dispositivos · pessoas da casa e suas permissões · quais ações exigem confirmação ·
câmeras e suas zonas · horários e rotinas · quais canais notificam o quê · regras proativas ·
mapeamento dispositivo↔cômodo · quais modelos rodam local vs nuvem.

### Como implementar (o padrão, não a exceção)

1. **Tabela `setting`** chave/valor tipada por escopo (global, por usuário, por dispositivo), com
   default no código e sobrescrita no banco.
2. **Entidades de domínio configuráveis** têm tabela própria (`room`, `device`, `person`,
   `camera`, `automation_rule`, `model_catalog`, `connector_def`), nunca constante.
3. **Toda config tem tela.** Um campo que só existe no banco e não aparece na UI viola o princípio
   tanto quanto um `const`.
4. **Default sensato sempre.** Zero configuração obrigatória para o app subir e funcionar — quem
   não quiser mexer, não mexe.
5. **Validação no servidor.** Config vinda do front é entrada não confiável: zod, faixa e tipo.
6. **Mudança de config não exige restart.** Ler do banco por request (com cache curto), não no boot.

⚠️ **Não faça isso de uma vez para o app inteiro.** Cada onda migra o que é da sua área. O que a
Onda 1 entrega é a **infraestrutura** de config (tabela + leitura + cache + tela base) e migra as
constantes do motor de chat; as demais ondas usam a infraestrutura já pronta.

---

## 3. COMO SUBIR TUDO (comandos verificados nesta máquina Windows)

```bash
# 1. Banco (Docker Desktop precisa estar aberto)
cd /c/Users/Users/Documents/github/orbita
docker compose up -d db          # orbita-db, pgvector, porta 5433

# 2. ATENÇÃO: pnpm 11.8 exige Node >= 22.13; o Node ativo é 20.20.2.
#    Node 22 existe em /c/ProgramData/nvm/v22.22.3 — use-o direto.
export PATH="/c/ProgramData/nvm/v22.22.3:$PATH"

# 3. Migrações
cd apps/web && node ./node_modules/drizzle-kit/bin.cjs migrate

# 4. Web
node ./node_modules/next/dist/bin/next dev -p 3000       # ~15s até Ready

# 5. Serviço de voz (o default /models não existe no Windows)
cd ../voice
export VOICE_MODELS_DIR="C:/Users/Users/Documents/github/orbita/apps/voice/models_test"
./.venv/Scripts/python.exe -m uvicorn main:app --host 127.0.0.1 --port 8001
```

**Conta de teste:** `wesley@orbita.local` / `Orbita@2026`
**Verificação:** `curl localhost:3000/api/health` → `db/voice/ollama: up`
**Ollama local:** já tem `qwen2.5:3b` e `moondream`.

---

## 4. ESTADO ATUAL VERIFICADO

> **Atualização 2026-09-16 (fim da Onda 1):** o que está abaixo descreve o estado ANTES da onda.
> O que mudou: existe `apps/api` (NestJS, porta 3010) como processo persistente com cron real,
> event bus persistido (`event_log`), regras proativas (`automation_rule`), renovação de token e
> aviso de contas a vencer; `packages/db` e `packages/core` extraídos; 40 rotas migradas em
> paridade (só `/api/auth/*` e o callback OAuth ficam no Next, com rewrite de origem única);
> infraestrutura de config (`setting` + tela "Ajustes", 48 chaves); registro de tools por domínio
> com gate derivado do risco (25 tools, catálogo com tela, MCP com gate por padrão); cadastro
> fechado após o primeiro usuário. Decisões do dono registradas em `CLAUDE.md` §2 e na memória
> da sessão. O que segue vale como histórico.
>
> **Atualização 2026-09-17 (fim da Onda 2):** Calendar watch e Gmail watch por polling (sem URL
> pública ainda), aviso pré-reunião com contexto do RAG, extração de compromissos com criação de
> tarefa em um clique, resumo em mapa-redução para reunião longa, e nomear locutor pós-reunião
> (versão leve, sem voiceprint). `generateObject` do AI SDK não funciona contra Ollama; use
> `generateStructured` (`packages/core/src/meetings/structured.ts`). B6.3 (streaming STT) deixado
> de fora, de propósito: depende da mesma URL pública do B9.1. Detalhe em `CLAUDE.md` §8-9.
>
> **Atualização 2026-09-16 (fim da Onda 3, a casa):** Home Assistant como ferramenta (REST +
> WebSocket com reconexão), busca semântica de entidade (`packages/core/src/home/entities.ts`),
> cômodo/pessoa/permissão por cômodo cadastrados pela tela, risco por domínio configurável (decisão
> do dono: fechadura/alarme/portão/garagem no gate; luz/tomada/mídia/clima direto). `assertPublicUrl`
> ganhou uma exceção estreita (`assertLocalOrPublicUrl`) só para o HA, ainda bloqueando metadado de
> nuvem e faixas reservadas. `chat.maxSteps` subiu de 5 para 12 (uma rotina de casa encadeia várias
> chamadas).
>
> **Atualização 2026-09-16 (fim da Onda 4, canais):** Teams (Graph API, escopo mínimo de chat/canal),
> roteamento de notificação pela própria engine de regras (ações `whatsapp`/`teams_chat`/`teams_canal`,
> sempre enfileiradas, nunca diretas). WhatsApp (CH.2) teve o escopo reduzido por uma limitação real:
> não dá para fazer OAuth por usuário sem revisão de app da Meta (Embedded Signup); o que ficou é um
> cadastro de token/phone_id pela tela, sem hardcode, mas ainda um único WhatsApp por conta (não por
> pessoa da casa). Trilha de auditoria (B7.2) cobrindo memória (salvar/esquecer) e chamadas MCP.
>
> **Atualização 2026-09-16 (fim da Onda 5, câmeras):** cadastro de câmera pela tela (sem lista fixa),
> cada uma com um token de webhook próprio; ingestão de evento pontual (`POST /api/cameras/ingest`,
> pensado para o Frigate ou qualquer script equivalente) grava o evento e emite no event bus — quem
> decide se é alerta de segurança é a REGRA que o dono cadastrar sobre `camera.detected`, nunca o
> LLM. Narração é sob demanda por padrão (decisão do dono), via VLM sobre o último keyframe com
> imagem, nunca vídeo contínuo. Retenção configurável (`cameras.retentionDays`), e desligar a câmera
> é o opt-out por cômodo. **Gesto (MediaPipe/pose) NÃO foi implementado**: é um pipeline de vídeo
> separado da narração, e não há hardware de câmera real neste ambiente de dev para validar contra
> stream de verdade — fica como gap aberto, não como decisão tomada.
>
> **Atualização 2026-09-16 (fim da Onda 6, voz ambiente):** a sessão OpenAI Realtime ganhou as
> MESMAS tools do chat de texto (B7.2): o backend monta `{name, description, parameters}` em JSON
> Schema (`z.toJSONSchema`, nativo do Zod 4, sem nova dependência) a partir do registro de tools;
> quando o modelo chama uma função por voz, o browser repassa para `POST /api/realtime/tool`, que
> roda pelo MESMO gate derivado de risco do chat (`runRealtimeTool` em `packages/core/src/tools/index.ts`)
> — uma tool arriscada enfileira em vez de executar, e a confirmação falada (B7.7) sai de graça,
> porque o modelo narra o resultado da função (“mandei para aprovação”) sem código especial. **O que
> ficou de fora, por depender de hardware ou de um problema maior não resolvido nesta sessão:**
> identidade de dispositivo/satélite por cômodo (B5.3-B5.5, precisaria de identificação de quem fala,
> não só de qual cômodo — o mesmo "problema separado e bem maior" do voiceprint citado em §7.3), VAD
> real com Silero e STT em streaming (B5.1, pipeline de áudio que não dá para validar sem teste de
> microfone ao vivo), roteamento de áudio por cômodo (B5.10, exige múltiplos endpoints de saída de
> som) e fazer o wake word local coexistir com o modo realtime (hoje um desliga o outro de propósito,
> em `use-voice.ts`; os dois disputam o microfone e testar a mudança sem hardware físico seria
> arriscar quebrar o que já funciona sem conseguir verificar).


### Stack

Monorepo Turborepo + pnpm. `apps/web` (Next 16.2.10, React 19, Tailwind 4, Better Auth 1.6,
Drizzle, AI SDK 7) · `apps/mobile` (Expo 54, fora do workspace pnpm) · `apps/voice`
(FastAPI + faster-whisper + Piper + Vosk) · `packages/llm`.

**O backend são 42 route handlers do Next.** Não existe servidor de aplicação separado.

### O que NÃO existe (verificado por grep)

Fila · broker · cache distribuído · worker · **cron** · event bus · WebSocket servido pelo Next ·
tracing · métricas · tabela de auditoria · RBAC · agentes/planner · sumarização de contexto ·
conceito de dispositivo · conceito de cômodo · qualquer linha de Home Assistant.

### ⚠️ GAP RAIZ

O agendador de rotinas é um **`setInterval` de 5 min dentro do navegador**, em
`apps/web/src/components/routines-panel.tsx:30`. Não há outro chamador de `/api/routines/run`.

**Sem aba aberta, a Órbita não faz nada.** Proatividade, Home Assistant bidirecional, escuta de
ambiente e câmeras **todos** dependem de resolver isto primeiro.

### Medições de acoplamento (a janela para migrar)

| Área | Linhas | Acoplamento ao Next |
|---|---|---|
| `packages/llm` | 512 | **0 imports** |
| `apps/web/src/lib` | 3.525 | **1 import** (`next/headers` em `session.ts`) |
| 42 rotas `/api` | 1.403 | **0 `NextResponse`** — 40 usam `Response.json` |
| `components/` | 3.460 | Next/React (fica) |

Traduzindo: ~4.000 linhas de lógica praticamente prontas para sair.

### Maturidade por área de foco

| Área | Estado | Detalhe |
|---|---|---|
| Chat + streaming | 🟢 Alta | NDJSON, failover, disjuntor |
| Voz (STT/TTS/wake/barge-in) | 🟢 Alta | **O melhor ativo do projeto** |
| Finanças | 🟢 Alta | a pagar/receber, vencimento, OCR de comprovante, extrato PDF |
| Conectores | 🟡 Média | Gmail completo, Slack, Notion. Teams ❌, WhatsApp sem OAuth |
| RAG + memória | 🟡 Média | pgvector + HNSW; sem sumarização, sem rerank |
| **Reuniões** | 🔴 **Baixa** | `meeting-panel` grava **janelas de 8s e perde áudio entre elas**; sem diarização; só microfone |
| Roteador de modelos | 🔴 Baixa | Uma regex. Ver §6 |
| Proatividade | 🔴 Muito baixa | `setInterval` no browser |
| Casa / câmeras | ⚪ Zero | — |

### Pontos fortes que NÃO devem ser destruídos na migração

- **Gate de ações** (`action_queue` + `lib/connectors/execute.ts`): o LLM só enfileira propostas;
  a execução real só acontece via `/api/actions` com aprovação humana. Defesa **estrutural**
  contra prompt-injection. É o melhor design do projeto — replicar para comandos de casa.
- **Cadeia de TTS** Edge → Gemini → Piper com degradação automática.
- **`splitFala`** (`lib/voice/engine.ts`): primeiro trecho curto para a fala começar em ~2s.
- **`LocalWake`** (`lib/voice/speech.ts`): wake word no aparelho, religa sozinho.
- **SSRF guard** (`lib/net/ssrf.ts`): completo (IPv4/IPv6/redirects/metadata).
- **Cripto de tokens** AES-256-GCM com falha explícita em produção.
- **PromptComposer** (`lib/chat/compose.ts`): chunks com prioridade e orçamento.

---

## 5. DECISÕES JÁ TOMADAS (não reabrir sem motivo novo)

| Decisão | Escolha | Motivo |
|---|---|---|
| **Separar backend** | **Sim — NestJS em `apps/api`** | Precisa de processo persistente (WS do HA, cron, event bus). Nest *é* um processo longo |
| **Momento** | **Agora, de uma vez** | Sem deploy, sem usuários, sem dado de produção, dev solo. O acoplamento nunca mais será tão baixo |
| **Paridade primeiro** | Migrar sem mudar comportamento; features novas só depois de verde | Não conflar duas mudanças que falham por motivos diferentes |
| **ORM** | **Manter Drizzle** | pgvector + HNSW + `cosineDistance` já funcionam e têm teste. Prisma seria custo puro |
| **Origem única** | Reverse proxy (Caddy/Traefik): `/api/auth/*` e `/api/connectors/*/callback` → Next; resto de `/api/*` → Nest; demais → Next | Resolve cookie, CORS e streaming NDJSON de uma vez. E é necessário no deploy 24/7 de qualquer forma |
| **Auth na fronteira** | Next valida sessão e emite token S2S assinado para o Nest | O cookie do Better Auth vive no Next |
| **Fica no Next** | UI, Better Auth, callbacks OAuth, BFF fino | É onde esses são mais fortes |
| **Multi-tenant** | **Proibido** | Ver §2 |
| **Espaço** | Criar `device` e `room` no schema **já**, mesmo sem uso | Adicionar coluna depois com dado dentro é caro |

### Estrutura alvo

```
orbita/
├─ apps/
│  ├─ web/       Next 16 — UI + Better Auth + callbacks + BFF fino
│  ├─ api/       NestJS — chat, router, tools, conectores, HA, eventos, cron, WS
│  ├─ voice/     Python (inalterado)
│  └─ mobile/    Expo (inalterado)
└─ packages/
   ├─ db/        Drizzle schema + client      ← extrair de apps/web/src/lib/db
   ├─ core/      domínio puro (zero framework) ← extrair de apps/web/src/lib
   ├─ llm/        provedores + roteador        ← já existe
   └─ contracts/  DTOs zod compartilhados
```

### Ordem da migração

1. `packages/db` — mecânico
2. `packages/core` — mecânico (resolver o único import de `next/headers`)
3. `apps/api` — esqueleto Nest + módulos + config + S2S
4. 42 rotas → controllers Nest, **em paridade**
5. `apps/web` vira BFF + reverse proxy na frente
6. Paridade verde: `vitest` (compose, crypto, ssrf, chunk, economics, llm, connectors, engine,
   speech) + smoke manual de chat, voz, conectores, RAG

Estimativa: **5-7 dias de trabalho focado.** As 3 rotas que não são mecânicas: o chat
(`streamText` + failover + cleanup de MCP), o `[...all]` do Better Auth (fica no Next) e
`/api/tts` (cadeia com `AbortSignal` atravessando a fronteira).

---

## 6. ROTEADOR DE MODELOS — o que portar do Adalink e o que NÃO portar

Medido em `../adalink-platform/apps/chat-service/src/infrastructure/ai/`:

| Peça | Linhas | Veredito |
|---|---|---|
| `rule-based-prefilter.service.ts` | ~200 | ✅ **Portar quase intacto** (imports: `@Injectable` + 2 tipos) |
| `heuristic-complexity-scorer.service.ts` | ~250 | ✅ **Portar quase intacto** |
| Specs de ambos | ~1.700 | ✅ Portar — é a rede de segurança do porte |
| `ModelTier` / `RoutingLayer` / `FallbackReason` | — | ✅ Portar (enums/tipos) |
| `routing-pool.service.ts` | 301 | 🟡 Adaptar (depende de repositório de banco) |
| `model-registry.ts` | 399 | 🔴 Reescrever |
| `llm-models.catalog.ts` | 1.586 | 🔴 **Não portar** |
| `model-router.service.ts` | 1.544 | 🔴 **Reescrever** |

### Por quê

```
grep -c -i "ollama|local|llama.cpp|vllm"  em model-registry.ts  →  0
```

**O roteador do Adalink não tem nenhuma noção de modelo local.** Tudo é chaveado por `gatewayId`
do Vercel AI Gateway, e os tiers são de **custo** (`$`/`$$`/`$$$`). Ele também arrasta
`organizationId` (10 usos), `SecurityServiceClient` (outro microserviço) e libs `@adalink/*`.

O eixo primário do Jarvis é **local vs nuvem** (latência, offline, privacidade) — dimensão que
não existe lá.

### Desenho alvo: roteador de dois eixos

```
              ┌─ LOCAL  (latência, offline, privacidade)
   eixo 1 ────┤
              └─ NUVEM  (qualidade, contexto longo)
                     │
              ┌──────┴──────┐
   eixo 2 ────┤  $  $$  $$$ │   ← o tier do Adalink entra aqui dentro
              └─────────────┘

   camadas:  rule_based → heuristic → llm_classifier → fallback
```

Conceitos do Adalink que valem muito: `PoolRole` (`default`/`fallback`/`judge-gated`),
`ttftClass` + `TTFT_CLASS_ORDER` (desempate por latência dentro do tier), `FallbackReason`
tipado, timeouts em cascata (2s/2,5s/3s).

**Aviso de calibragem:** a cascata tripla de classificador LLM faz sentido com milhares de
turnos/dia. Numa casa, o **prefilter de regras resolve ~90%** — e para "apaga a luz" a cascata é
o oposto do que se quer. Adicionar `taskType: home_command` que curto-circuita direto para o
modelo local pequeno.

### Outras peças do Adalink

- **OCR** (`apps/processing-service`, 838 linhas): `render-pdf-to-images → run-tesseract →
  vision-fallback por confiança`. ✅ **Portar quase direto** — melhor relação valor/linha. O
  `lib/ocr.ts` atual tem ~50 linhas e nenhum fallback.
- **`rag-service`** (45.143 linhas, 419 arquivos): 🔴 **não portar o serviço.** Garimpar
  `cohere-reranker` e as ideias de `memory-graph`/`continuity`.

---

## 7. AS TRÊS CAPACIDADES NOVAS

### 7.1 Câmeras, visão em tempo real, gestos e segurança

**O maior item novo. Não construir do zero.**

Arquitetura recomendada a avaliar (decidir com o dono antes de codar):

```
Câmeras IP (RTSP)
      ↓
  FRIGATE (NVR local, detecção de objeto, roda em GPU/Coral)
      ↓ eventos via MQTT  +  Home Assistant
      ↓
  EVENT BUS da Órbita                    ← §5, o processo persistente
      ↓
  ┌───────────────┬──────────────────────┬────────────────────┐
  │ Segurança     │ Narração ao vivo     │ Gestos             │
  │ regra+alerta  │ VLM em KEYFRAME      │ MediaPipe/pose     │
  │ (sem LLM)     │ (não em 30fps!)      │ (stream dedicado)  │
  └───────────────┴──────────────────────┴────────────────────┘
```

Pontos técnicos que precisam estar claros:

- **Não se manda vídeo contínuo para um VLM.** Custo e latência inviabilizam. O padrão é:
  detector barato (Frigate/YOLO) dispara evento → VLM roda em 1 keyframe → narra.
- **Gesto não é trabalho de VLM.** Pose estimation (MediaPipe) é a ferramenta certa, em pipeline
  separado do de narração.
- Já existe base mínima: `resolveVisionModel()` em `packages/llm/src/providers.ts` (OpenAI gpt-4o
  ou `moondream`/`qwen2.5vl` local) e `/api/vision` — mas **só para screenshot único**, via
  `getDisplayMedia`. Zero código de câmera.
- **Privacidade não é opcional aqui.** Câmera 24/7 exige: indicador de gravação, política de
  retenção, opt-out por cômodo, e decisão explícita sobre o que sai de casa.
- **Impacto em hardware:** este item, somado a VLM local, é o que muda a conta de GPU. Ver §9.

### 7.2 Voz realtime

**Já existe e funciona:** `apps/web/src/lib/voice/realtime.ts` — OpenAI Realtime via WebRTC com
token efêmero, barge-in nativo, transcrição nos dois sentidos.

**O que falta:**

- **Tools na sessão realtime.** Hoje `/api/realtime/session` manda só `instructions`. Sem tools,
  o modo realtime **não consegue acionar a casa** — é conversa, não ação. A Realtime API suporta
  function calling; é config de sessão.
- **Alternativa local para offline.** O caminho realista não é um modelo S2S local, e sim
  pipeline STT streaming → LLM local → TTS em chunks. Parte das peças já existe.
- Hoje o modo realtime é mutuamente exclusivo com o wake word (`use-voice.ts` desliga um ao
  ligar o outro). Para a casa, precisam coexistir.

### 7.3 Reuniões com diarização

**Estado real:** `components/meeting-panel.tsx` grava **janelas de 8 segundos**, manda cada uma
para `/api/stt` e concatena. **Perde o áudio entre as janelas** (limitação assumida no
`CHECKLIST.md`). Depois `/api/meeting/summarize` resume e arquiva no RAG.

**O que falta, em ordem de custo/benefício:**

1. **Diarização — ganho mais barato do projeto inteiro.** A AssemblyAI suporta `speaker_labels`;
   `lib/stt/assemblyai.ts` simplesmente **não passa o parâmetro**. Ver §8.
2. **Captura contínua** sem buraco entre janelas.
3. **Transcrição em streaming** (a AssemblyAI tem API de streaming; o código usa a de arquivo com
   polling de 1,5s).
4. **Áudio de sistema** — hoje só microfone, então **não capta Teams/Meet/Slack**. Precisa de
   loopback / `getDisplayMedia({audio:true})`.
5. **Identificação de locutor** (quem é "Speaker A") — voiceprint, problema separado e bem maior.
6. **Extração de compromissos** — "você prometeu X pro cliente ontem". É o que transforma
   transcrição em valor real para uma rotina conturbada.

### 7.4 Registro de tools (o catálogo que deve crescer)

**Princípio do dono:** as tools nunca saem. Elas são cadastradas do jeito certo e o catálogo cresce,
porque cada tool funcional é uma coisa a mais que ele consegue fazer pelo assistente.

#### Estado atual (verificado)

| Origem | Quantas | Onde | Problema |
|---|---|---|---|
| Base | **15** | `lib/chat/tools.ts` (342 linhas) | Objeto literal único; crescer = inchar o arquivo |
| Conector | **10** | `lib/chat/connector-tools.ts` | Gate chamado à mão (`enqueue()`) dentro de cada tool perigosa |
| MCP | dinâmico | `lib/mcp/client.ts` | **Executa direto, sem gate nenhum** |

Base: `hora_atual` · `salvar_memoria` · `esquecer_memoria` · `buscar_conhecimento` ·
`registrar_gasto` · `resumo_financeiro` · `adicionar_conta` · `resumo_financeiro_completo` ·
`contas_a_vencer` · `adicionar_tarefa` · `listar_tarefas` · `criar_widget` · `previsao_tempo` ·
`pesquisar_web` · `ler_pagina`

Conector: `ler_emails` · `rascunhar_email` · `enviar_email` · `listar_eventos` · `criar_evento` ·
`buscar_notion` · `ler_pagina_notion` · `listar_canais_slack` · `enviar_slack` · `enviar_whatsapp`

**As 25 continuam.** O que muda é a forma de registrar.

#### Desenho alvo

```
  domínio/memoria/tools.ts ─┐
  domínio/financas/tools.ts ┤
  domínio/casa/tools.ts ────┤    registerTool({ name, description, schema,
  conector/google/tools.ts ─┼──►   categoria, risco, requer, execute })
  mcp (descobertas) ────────┤              │
  home assistant (descob.) ─┘              ▼
                                   ┌───────────────┐
                                   │  TOOL REGISTRY │──► tabela `tool` (catálogo + UI)
                                   └───────┬───────┘
                                           │ por turno
                          ┌────────────────┴────────────────┐
                          ▼                                  ▼
                 SELEÇÃO por relevância            WRAPPER de risco
                 (embedding, top-K + núcleo)       leitura/escrita → executa
                                                   efeito_externo/perigoso → action_queue
```

#### Os cinco requisitos

1. **Registro por domínio.** Cada área registra suas tools. Adicionar uma é criar a declaração no
   domínio certo, sem tocar em arquivo central.

2. **Metadados obrigatórios.** `categoria` (memória, finanças, casa, comunicação, agenda, web…),
   `risco` (`leitura` · `escrita` · `efeito_externo` · `perigoso`) e `requer` (o conector ou
   capacidade que precisa existir: `google`, `homeassistant`, `camera`…).

3. **Gate derivado do risco, pelo registro.** Hoje cada tool perigosa chama `enqueue()` à mão — e
   a MCP simplesmente não chama. O registro deve embrulhar a execução: `efeito_externo` e
   `perigoso` vão para `action_queue` **automaticamente**. A invariante de segurança deixa de
   depender de alguém lembrar. Isso resolve o risco nº 3 da §10 (MCP sem gate) de brinde.

4. **Catálogo é dado, com tela** (princípio zero hardcode). Tabela `tool` sincronizada com o
   registro. Na UI o dono vê todas, liga/desliga, e **sobrescreve o risco** (ex.: decide que
   `enviar_slack` para um canal específico não precisa de aprovação).

5. **Seleção por relevância — o que torna o crescimento sustentável.** Esta é a consequência de
   engenharia que não pode ser ignorada: cada definição de tool custa ~100-300 tokens, e modelos
   escolhem pior a tool certa quando recebem dezenas de opções. Crescer de 25 para 150 **sem
   seleção deixa o assistente pior, não melhor.** Solução: embedding da descrição de cada tool,
   top-K por turno pela similaridade com o pedido, mais um núcleo sempre presente. O projeto já
   faz exatamente isso para skills (`getSkillInstructions`, cosseno) — é generalizar o padrão.

   Bônus de latência: o **caminho rápido doméstico** (B10.1) vira "selecione só as tools da
   categoria `casa`", sem mandar as 25 para o modelo local pequeno.

#### Onde entra

**Onda 1** — o registro e o wrapper de risco, porque a migração para o Nest vai mover todas as
tools de qualquer forma: é o momento de movê-las já no formato certo. As 25 existentes migram em
paridade (mesmo nome, mesmo comportamento). A seleção por relevância pode vir logo depois, mas
**antes** da Onda 3 — é a Casa que vai multiplicar o número de tools.

---

## 8. ROADMAP EM ONDAS

```
ONDA 0  Ganhos rápidos de reunião          (1-2 dias, sem depender de nada)
        • diarização (speaker_labels na AssemblyAI)
        • captura contínua sem buraco entre janelas
        • áudio de sistema (Teams/Meet)

ONDA 1  O processo vivo                     ← destrava TUDO
        • migração NestJS (§5) em paridade
        • INFRAESTRUTURA DE CONFIG (§2.1): tabela `setting`, leitura com cache,
          tela base de ajustes, e as constantes do motor de chat migradas
        • cron real + event bus + regras proativas
        • brinde: aviso de vencimento (a lógica `contas_a_vencer` já existe, ninguém a chama)

ONDA 2  Reuniões de verdade                 ← dor nº 1
        • Calendar watch + aviso pré-reunião
        • extração de compromissos e ações

ONDA 3  Casa                                ← dor nº 2
        • Home Assistant REST (comando) + WebSocket (evento)
        • índice semântico de entidades (pgvector — 150-400 entidades não cabem no prompt)
        • modelo de cômodos + risco por ação (luz direto; fechadura no gate)
        • tools COMPOSTAS (`ha_cena`), não uma por entidade

ONDA 4  Canais                              ← dor nº 4
        • Teams · WhatsApp por usuário · roteamento de notificação

ONDA 5  Câmeras e percepção                 ← maior item, maior custo
        • Frigate + event bus + VLM em keyframe + MediaPipe para gestos
        • política de privacidade de captura

ONDA 6  Voz ambiente
        • satélites por cômodo · silero-vad · identidade de dispositivo/cômodo
        • realtime com tools coexistindo com wake word
```

**Finanças não tem onda própria** — já funciona e ganha proatividade de carona na Onda 1.

---

## 9. ANTI-PADRÕES — o que NÃO fazer

1. **Não** trazer `organizationId`/multi-tenant do Adalink. Entra sozinho se não for barrado.
2. **Não** portar o `model-router.service.ts` nem o `llm-models.catalog.ts` inteiros.
3. **Não** portar o `rag-service` (45k linhas).
4. **Não** trocar Drizzle por Prisma.
5. **Não** misturar a migração com features novas — paridade primeiro.
6. **Não** criar `apps/api` antes de `packages/db` e `packages/core` (duplica código na hora).
7. **Não** mandar vídeo contínuo para VLM.
8. **Não** criar uma tool por entidade do Home Assistant.
9. **Não** exigir aprovação humana para "apagar a luz" — mata a experiência. Risco **por
   domínio**: luz direto, fechadura/alarme no gate.
10. **Não** tirar o Better Auth do Next.
11. **Não** aumentar o escopo OAuth do Google — hoje é `https://mail.google.com/` (inclui
    apagar) e há escopo de `contacts`/`tasks` pedido **sem nenhum código usando**. Reduzir.

---

## 10. RISCOS DE SEGURANÇA ABERTOS (corrigir antes de expor qualquer coisa)

| # | Risco | Detalhe |
|---|---|---|
| 1 | **Cadastro aberto** | `ALLOWED_EMAILS` vazio no `.env` — qualquer um com a URL cria conta com acesso a Gmail/Agenda/finanças |
| 2 | **Escopo Google total** | `https://mail.google.com/` permite apagar o Gmail inteiro |
| 3 | **MCP sem gate** | Tools de servidor MCP executam **direto**, sem aprovação humana |
| 4 | **Sem RBAC** | Irrelevante com 1 usuário; crítico numa casa com fechaduras |
| 5 | **Sem audit log** | `action_queue` cobre 4 tipos; leitura, memória e MCP não deixam trilha |
| 6 | **Rate limit em `Map`** | Por processo — some com múltiplas instâncias |
| 7 | **Sem CSP/HSTS** | Pendência assumida no `next.config.ts` |
| 8 | **Token Render em claro** | `.mcp.json` (gitignored, mas em disco) — rotacionar |
| 9 | **Privacidade de embeddings** | `packages/llm/src/embeddings.ts` manda tudo para o Gemini se a chave existir, **mesmo em modo privacidade**. Vira cadeia local→nuvem |
| 10 | **SSRF vs LAN** | `assertPublicUrl` bloqueia 192.168/10/172.16 — hoje é **impossível** cadastrar o Home Assistant como MCP. Precisa de exceção deliberada |

---

## 11. LATÊNCIA — pontos críticos medidos no código

Para "Jarvis, apaga a luz" ficar imperceptível, o caminho atual tem estes obstáculos:

| # | Ponto | Onde |
|---|---|---|
| 1 | **RAG bloqueante até 3.500ms** antes do 1º token | `api/chat/route.ts` — o gate de trivialidade **não** pega "apaga a luz da sala" |
| 2 | **`buildMcpTools` no hot path** | Conecta em todos os MCPs e chama `listTools()` **a cada mensagem**. Sem cache |
| 3 | **`ollamaUp()` incondicional** | Roda sempre, mesmo indo para nuvem. Timeout 1.500ms |
| 4 | 6 queries antes do primeiro byte | Conversa, histórico, insert, persona, conectores, skills |
| 5 | TTFT do LLM | Gargalo dominante no local sem GPU |
| 6 | TTS ~1s | Mitigado pelo `splitFala`, não eliminado |

**Solução estrutural:** um **fast path** para comando doméstico que pula RAG, MCP, persona e
histórico, roteia para modelo local pequeno e responde com TTS pré-sintetizado ("Pronto").

---

## 12. HARDWARE — decidir SÓ depois da prova de conceito

O dono ainda **não comprou** a máquina, e a escolha depende de uma resposta que só o código dá:

- Se o roteador mandar comando doméstico para modelo de 1-3B e o resto para a nuvem →
  **mini-PC sem GPU resolve**.
- Se houver VLM local para câmeras + modelo 7B+ local com boa latência →
  **GPU é obrigatória**, e o orçamento muda por um fator de 3-5x.

**Prova de conceito recomendada antes de qualquer compra (≈1 dia):** subir um processo Node
persistente ao lado do Next, no mesmo Postgres, que (a) abra o WebSocket do Home Assistant e
grave eventos numa tabela, (b) rode as rotinas devidas por cron real, e (c) acione uma tool do HA
via REST a partir de um comando de voz.

Isso responde com código, não com suposição: o modelo "Next para UI + Nest para eventos"
funciona? A latência LAN→HA é aceitável? Descoberta de entidades cabe no contexto ou precisa de
índice vetorial?

---

## 13. ARQUIVOS DE REFERÊNCIA

| Assunto | Caminho |
|---|---|
| Orquestração do chat (290 linhas fazendo tudo) | `apps/web/src/app/api/chat/route.ts` |
| Tools base (15) | `apps/web/src/lib/chat/tools.ts` |
| Tools de conector + gate | `apps/web/src/lib/chat/connector-tools.ts` |
| Execução pós-aprovação | `apps/web/src/lib/connectors/execute.ts` |
| Roteador atual (a regex) | `packages/llm/src/catalog.ts` → `routeModelKey` |
| Failover + disjuntor | `packages/llm/src/failover.ts` |
| Provedores (7) | `packages/llm/src/providers.ts` |
| Voz cliente (TTS/wake/VAD) | `apps/web/src/lib/voice/engine.ts` |
| Wake word no aparelho | `apps/web/src/lib/voice/speech.ts` |
| Realtime WebRTC | `apps/web/src/lib/voice/realtime.ts` |
| STT (diarização falta aqui) | `apps/web/src/lib/stt/assemblyai.ts` |
| Reunião (janelas de 8s) | `apps/web/src/components/meeting-panel.tsx` |
| RAG | `apps/web/src/lib/rag/retrieve.ts` |
| Agendador no browser (o gap raiz) | `apps/web/src/components/routines-panel.tsx:30` |
| Backlog pré-existente do dono | `CHECKLIST.md` (itens R1-R5, V1, I1-I2, S1) |
| Router do Adalink | `../adalink-platform/apps/chat-service/src/infrastructure/ai/` |
| OCR do Adalink | `../adalink-platform/apps/processing-service/src/application/use-cases/ocr/` |

---

## 13.1 CHECKLIST PUBLICADO (manter atualizado)

O dono acompanha o progresso por um painel publicado:

**https://claude.ai/artifact/K4pZh4kukZfJWdxXcYDeD6**

**Ao terminar qualquer item, atualize o painel** — não é opcional, é como ele enxerga o projeto:

1. `Artifact` com `action: "read"` e essa `url` para pegar o HTML atual
2. Mude o `data-st` do item para `feito` / `agora` e a classe do `.chip`; adicione
   `class="is-feito"` no `li`. As contagens e o anel de progresso se recalculam sozinhos
3. Atualize a data no rodapé
4. Republique passando a mesma `url` (sem `url`, cria um artefato novo e o dono perde o link)

Item que virou decisão do dono ganha `data-st="decide"` e `chip decide`.

---

## 14. COMO COMEÇAR

1. Subir tudo (§3) e confirmar `/api/health` verde.
2. Confirmar com o dono o sequenciamento: **Onda 0 antes da migração** (relief imediato na dor
   nº 1 e valida o pipeline de reunião antes de movê-lo de lugar).
3. Onda 0, começando por `lib/stt/assemblyai.ts` + `components/meeting-panel.tsx` juntos — a
   suspeita é que o buraco entre janelas e a falta de diarização se resolvem na mesma mudança:
   parar de fatiar em 8s e mandar áudio contínuo com `speaker_labels` ligado.
4. Depois, migração (§5) em paridade.

**Perguntas em aberto para o dono, antes de codar as respectivas ondas:**

- Reverse proxy com origem única está confirmado? (afeta toda a Onda 1)
- Câmeras: IP/RTSP, webcam ou já existe algo? Frigate é aceitável como camada de percepção?
- Narração de câmera é sob demanda ("o que está acontecendo na sala?") ou contínua? Muda
  radicalmente custo e privacidade.
- Quem mais mora na casa e precisa de permissão diferente?
