# ÓRBITA — Assistente Pessoal de IA

Assistente pessoal **local-first** estilo Jarvis, operado por voz. Chat com IA na sua máquina (Qwen 2.5 via Ollama), núcleo neural holográfico, e seletor de provedor (Local / Vercel AI Gateway / Claude Max).

> Monorepo pnpm/Turborepo · Next.js 16 · Better Auth · Drizzle/Postgres+pgvector · AI SDK 7 · FastAPI (voz) · Expo (mobile).

## Recursos
- **Voz**: wake word **"Ei Órbita"** (Vosk), STT local (faster-whisper), **TTS local** (Piper pt-BR), **conversa mãos-livres** com barge-in, e **tempo real premium** (OpenAI Realtime, opcional). Enviar áudio → transcrição (fallback AssemblyAI).
- **Memória & RAG** (pgvector): documentos, memória de longo prazo (add + **"esquece isso"**), **grafo de conhecimento**, busca semântica com citação de fonte.
- **Conectores** (OAuth, tokens criptografados AES-256-GCM): Gmail, Google Agenda, Notion, Slack, WhatsApp. **Ações com efeito só executam após você aprovar** no painel (gate anti prompt-injection).
- **Finanças**: gastos + contas a pagar/receber + saldo, **comprovante por foto → OCR → cadastro**, **importar extrato PDF**, alertas de vencimento.
- **Produtividade**: to-do list (com imagem), transcrição de reunião → resumo, rotinas proativas + notificações, **dashboard/insights**.
- **Ver a tela** (modelo de visão) · **acessar pastas** (indexa no RAG) · **PWA instalável** · **app mobile** (Expo, com voz).

## Pré-requisitos
- **Node 20+** e **pnpm 11+**
- **Docker** (para o Postgres + pgvector)
- **Ollama** rodando com os modelos: `qwen2.5:7b` (ou `:14b`) e `nomic-embed-text`
- **Python 3.10–3.13** + **uv** (só para o serviço de voz)

## Rodar (dev — verificado)

```bash
# 1. dependências
pnpm install

# 2. banco (Postgres + pgvector)
docker compose up -d db

# 3. modelos locais (uma vez)
ollama pull qwen2.5:7b
ollama pull nomic-embed-text

# 4. variáveis de ambiente
cp .env.example apps/web/.env   # ajuste BETTER_AUTH_SECRET

# 5. migrations
pnpm --filter @orbita/web db:migrate

# 6. app web  →  http://localhost:3000
pnpm dev

# 7. (opcional) serviço de voz  →  http://localhost:8001
cd apps/voice && uv sync && uv run uvicorn main:app --port 8001
```

Acesse **http://localhost:3000**, crie sua conta e vá para **/app**.

## Rodar tudo em containers (um único `up`)

Sobe **banco + migrations + voz + web** de uma vez. O Ollama continua no **host** (o container o alcança via `host.docker.internal`).

```bash
# 1. modelos locais no host (uma vez)
ollama pull qwen2.5:7b
ollama pull nomic-embed-text

# 2. segredo de auth (mín. 32 chars) — export ou coloque num .env na raiz
export BETTER_AUTH_SECRET="troque-por-um-segredo-forte-de-32+chars"

# 3. build + sobe o stack completo
docker compose up --build
```

Fluxo do compose: `db` (healthcheck) → `migrate` (aplica Drizzle e encerra) → `web` (só sobe após migrate ok) + `voice`.
- Web → **http://localhost:3000**
- Voz → **http://localhost:8001** (o modelo Whisper baixa na 1ª transcrição, cacheado em volume)

Variáveis opcionais (Gateway/Claude/OAuth) podem ir num `.env` na raiz — o compose lê automaticamente. Para rodar em background: `docker compose up --build -d`; para derrubar: `docker compose down`.

## Provedores de IA
- **Local** (Ollama/Qwen 2.5) — padrão, grátis, offline. Sempre disponível.
- **Vercel AI Gateway** — defina `AI_GATEWAY_API_KEY` no `.env` (aparece no seletor).
- **Claude Max** — defina `CLAUDE_CODE_OAUTH_TOKEN` (assinatura Max via OAuth).

## Estrutura
```
orbita/
├─ apps/
│  ├─ web/     Next.js 16 (UI + API + Orb) — app principal
│  ├─ mobile/  Expo (iOS/Android): chat + voz — npm próprio
│  └─ voice/   FastAPI: STT (faster-whisper) + TTS (Piper) + wake word (Vosk)
├─ packages/
│  └─ llm/     provider layer (Local/Gateway/Claude) + embeddings + visão
└─ docker-compose.yml
```

O app mobile é gerenciado por npm próprio (Metro não convive com os symlinks do pnpm):
`cd apps/mobile && npm install && npm start`. Aponta para o mesmo backend (configure o IP em ⚙).

Progresso do desenvolvimento em [`CHECKLIST.md`](./CHECKLIST.md).
