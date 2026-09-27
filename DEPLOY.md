# ☁️ Deploy da Órbita na nuvem (passo a passo)

Este guia leva a Órbita do "roda na minha máquina" para "roda na nuvem, acesso de qualquer lugar".

> **Leia isto antes de começar.** A Órbita foi feita *local-first*. Na nuvem, os recursos que dependem da sua máquina mudam:
>
> | Recurso | Local | Na nuvem |
> |---|---|---|
> | Modelos de IA | assinatura, nuvem ou Ollama | assinatura ou provedores de nuvem (Groq/Gemini/OpenAI) |
> | Embedding do RAG | Gemini/OpenAI (ou Ollama, se escolhido) | Gemini ou OpenAI (`GEMINI_API_KEY`/`OPENAI_API_KEY`) |
> | Voz / wake word | serviço Python local | host à parte, ou desligado |
> | Claude Max | token OAuth pessoal | **não pode** em servidor público (use outro provedor) |
> | Banco | Postgres no Docker | Postgres gerenciado (Neon/Supabase) |
>
> Traduzindo: o **chat, auth, finanças, tarefas, conversas, conectores e o RAG** sobem e funcionam já, desde que haja uma chave de nuvem. A **voz** e a **percepção** precisam de host próprio. Detalhe item por item em "O que muda na nuvem", logo abaixo.

## O que muda na nuvem (PRD-SEM-OLLAMA)

A Órbita funciona sem Ollama: ele é uma opção de quem quer privacidade total, nunca uma dependência. Esta tabela separa o que **precisa de um host próprio** do que **simplesmente não existe** na nuvem.

| Peça | Na nuvem | O que fazer |
|---|---|---|
| **Ollama** (modelo local, embedding local, visão local) | **não existe** | Nada. Em `llm.descobrirLocal` use "Nunca" (ou deixe no automático: a Render, a Vercel, o Fly e o Cloud Run são reconhecidos e o local some das cadeias). Ollama numa máquina sua com endereço público continua valendo via `OLLAMA_BASE_URL`. |
| Chat, rotinas, regras, resumo, memória, comprovante | provedor de nuvem | Uma chave basta. Sem nenhuma, a Órbita diz "Nenhum modelo disponível: configure uma chave em Ajustes, Modelos" em vez de tentar um modelo que não existe. |
| **Embedding do RAG** | Gemini ou OpenAI | `GEMINI_API_KEY` (grátis) ou `OPENAI_API_KEY`. A **assinatura do Claude não gera embedding**. Cada vetor guarda o modelo que o gerou; ao trocar, a tela de Memória mostra quantos ficaram fora da busca e oferece "Reindexar". |
| Leitura de página escaneada (visão) | nuvem ou assinatura | Com `ocr.visionProvider` em "Sempre na nuvem" e sem chave, a página fica só com o OCR e o motivo é registrado. |
| Reordenação do RAG (`rag.rerank` "local") | funciona | É ONNX dentro do próprio `apps/api`, não Ollama. |
| OCR (tesseract.js) | funciona | Roda em CPU no `apps/api`. |
| **`apps/voice`** (Piper, Vosk, whisper local) | **host próprio** | Render/Fly/Railway (Etapa 5). Sem ele: TTS pelo Edge/Gemini, wake word pelo navegador, transcrição pela AssemblyAI. Com `TTS_PROVIDER` fixo em `edge`/`gemini`, wake no navegador e AssemblyAI, o `/api/health` mostra a voz como `nao_usado`. |
| **`apps/perception`** (rosto, voz, gestos) | **host de casa** | Biometria nunca sai de casa (§5.4.1): o guard do `apps/api` recusa destino que não seja local. Na nuvem, identificação por rosto e voz fica desligada. |
| AssemblyAI | nuvem | É a IA dela mesma; `ASSEMBLYAI_API_KEY`. |
| Saúde (`/api/health`) | responde `ok` | Serviço que nenhum caminho usa aparece como `nao_usado`, não como `down`. |

A arquitetura na nuvem fica assim:

```
   [ Celular / Navegador ]
            │
   Vercel  ─┤  apps/web  (Next.js: UI + API)
            │
   Neon    ─┤  Postgres + pgvector
            │
   Provedor ┤  Groq / Gemini / OpenAI  (chat)
            │
   Render  ─┤  apps/voice  (opcional: voz/wake word)
```

---

## Etapa 0 — Contas que você vai precisar

Obrigatórias:
- **GitHub** (o repo já está lá: `Wesley-SdS/Orbita`).
- **Vercel** (grátis) → https://vercel.com
- **Neon** (Postgres grátis com pgvector) → https://neon.tech
- **1 provedor de IA.** O mais fácil e grátis é o **Groq** → https://console.groq.com

Opcionais (dá pra ligar depois):
- AssemblyAI (transcrição de áudio), Google/GitHub (login social + Gmail/Agenda), Resend (link mágico por e-mail), Render/Fly (serviço de voz).

---

## Etapa 1 — Banco de dados (Neon)

1. Crie um projeto no **Neon**.
2. No **SQL Editor** do Neon, habilite o pgvector:
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   ```
3. Copie a **connection string** (algo como `postgres://user:pass@ep-xxx.neon.tech/neondb?sslmode=require`). Guarde, é o seu `DATABASE_URL`.

4. Aplique as migrações do banco (rode no seu terminal, uma vez, apontando para o Neon):
   ```bash
   cd C:\Users\Users\Documents\github\orbita
   # PowerShell:
   $env:DATABASE_URL="postgres://...sua-url-do-neon..."
   pnpm --filter @orbita/web db:migrate
   ```
   Isso cria todas as tabelas no Neon.

---

## Etapa 2 — Web na Vercel

1. Em https://vercel.com/new, **importe o repositório** `Wesley-SdS/Orbita`.
2. Nas configurações do projeto:
   - **Root Directory:** `apps/web`
   - **Framework Preset:** Next.js (detecta sozinho)
   - **Install Command:** `pnpm install` (a Vercel entende o monorepo pnpm)
   - **Build Command:** `pnpm build` (padrão do Next)
3. Em **Environment Variables**, adicione (no mínimo):

   | Variável | Valor |
   |---|---|
   | `DATABASE_URL` | a URL do Neon (Etapa 1) |
   | `BETTER_AUTH_SECRET` | um segredo forte de 32+ caracteres |
   | `BETTER_AUTH_URL` | a URL da Vercel (ex.: `https://orbita.vercel.app`) |
   | `CONNECTORS_ENC_KEY` | uma chave aleatória (isola a cripto dos conectores) |
   | `GROQ_API_KEY` | a chave grátis do Groq |

   > Gere segredos com: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

4. Clique em **Deploy**. Quando terminar, acesse a URL, crie sua conta e teste o chat. Deve responder rápido (Groq na nuvem).

✅ **Neste ponto já funcionam:** login, chat (com Groq/Gemini/OpenAI), conversas, finanças, tarefas, persona, cards, LGPD.

---

## Etapa 3 — Provedores de IA (escolha um ou mais)

Adicione as chaves como variáveis de ambiente na Vercel. Cada provedor aparece no seletor sozinho quando a chave existe.

| Provedor | Variável | Onde pegar |
|---|---|---|
| Groq (grátis, rápido) | `GROQ_API_KEY` | console.groq.com |
| Google Gemini (grátis) | `GEMINI_API_KEY` | aistudio.google.com/apikey |
| OpenAI | `OPENAI_API_KEY` | platform.openai.com |
| Cohere | `COHERE_API_KEY` | dashboard.cohere.com |
| Vercel AI Gateway | `AI_GATEWAY_API_KEY` | vercel.com (muitos modelos numa chave) |

> ⚠️ **Claude:** na nuvem **não** use o `CLAUDE_CODE_OAUTH_TOKEN` (é da sua assinatura pessoal, viola o ToS num servidor público). Para ter Claude na nuvem, use o **Vercel Gateway** com um modelo da Anthropic, ou aguarde eu adicionar um provedor Anthropic por API key.

Depois de mudar variáveis, faça um **Redeploy** na Vercel.

---

## Etapa 4 — RAG na nuvem

Com `GEMINI_API_KEY` (grátis) ou `OPENAI_API_KEY`, a busca nos seus documentos e memórias funciona na nuvem sem nada a mais: o embedding padrão já prefere a nuvem quando há chave (`gemini-embedding-2` ou `text-embedding-3-small`, ambos cortados para as 768 dimensões da coluna). Para fixar um provedor, use **Ajustes → Onde gerar embeddings**.

Se o acervo veio de uma instalação que usava o Ollama, a tela **Memória → Manutenção do acervo** mostra quantos trechos são de outro modelo (ficam fora da busca, porque vetores de modelos diferentes não se comparam). Use **Reindexar acervo** uma vez.

---

## Etapa 5 — Voz e wake word (opcional, host à parte)

A Vercel não roda o serviço Python (`apps/voice`). Duas opções:

**Opção A — sem voz na nuvem (mais simples):** não configure nada de voz. A transcrição de áudio ainda funciona se você setar `ASSEMBLYAI_API_KEY` (nuvem), e a fala usa a voz do navegador. O wake word "Ei Órbita" fica indisponível.

**Opção B — com voz completa:** hospede `apps/voice` num serviço que roda Python persistente (**Render**, **Fly.io** ou **Railway**):
1. Crie um serviço apontando para a pasta `apps/voice` (tem `Dockerfile`).
2. Pegue a URL pública (ex.: `https://orbita-voice.onrender.com`).
3. Na Vercel, configure:
   - `VOICE_URL` = a URL do serviço (https)
   - `VOICE_PUBLIC_WS_URL` = a mesma, com `wss://` (ex.: `wss://orbita-voice.onrender.com`)

---

## Etapa 6 — Extras opcionais

Adicione na Vercel conforme quiser:

- **Transcrição premium:** `ASSEMBLYAI_API_KEY`
- **Notificações push:** gere o par VAPID com `node -e "console.log(require('web-push').generateVAPIDKeys())"` e configure `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.
- **Login social + Gmail/Agenda:** `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (no Google Cloud Console, cadastre o redirect `https://SEU-DOMINIO/api/connectors/google/callback` e `.../api/auth/callback/google`).
- **Link mágico por e-mail:** `RESEND_API_KEY`.
- **Notion / Slack / WhatsApp:** as respectivas chaves (veja `.env.example`).

> Sempre que trocar variáveis, faça **Redeploy**.

---

## Etapa 7 — App mobile (EAS)

O app nativo **não** vai pra Vercel; ele aponta para a sua URL da Vercel e é distribuído pela loja:

1. Em `apps/mobile`, ajuste o servidor para a URL da Vercel (na tela *Ajustes → configurar servidor*, ou no default do `lib/api.ts`).
2. Build com o EAS:
   ```bash
   cd apps/mobile
   npm install -g eas-cli
   eas login
   eas build --platform ios      # ou android
   ```
3. Publique na App Store / Play Store, ou instale o build de teste.

> ⚠️ O login do app nativo ainda tem o bug **B5** (pendente, precisa de diagnóstico no device). Enquanto isso, o web responsivo no navegador do celular é a via mais confiável.

---

## Resumo do que funciona em cada nível

| Nível | O que sobe | Funciona |
|---|---|---|
| **Mínimo** | Vercel + Neon + Groq | chat, auth, finanças, tarefas, conversas, LGPD |
| **+ Extras** | + AssemblyAI, VAPID, OAuth | transcrição, push, login social, conectores |
| **+ RAG** | + `GEMINI_API_KEY` ou `OPENAI_API_KEY` | busca nos seus documentos/memória |
| **+ Voz** | + apps/voice no Render/Fly | STT/TTS/wake word |
| **+ Mobile** | + EAS build | app nas lojas |

**Comece pelo Mínimo** (30 min, tudo grátis). Depois vá ligando os extras. Me chame para o **provedor Anthropic por API key** quando quiser Claude na nuvem sem o Gateway.
