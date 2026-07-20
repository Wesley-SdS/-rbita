# ☁️ Deploy da Órbita na nuvem (passo a passo)

Este guia leva a Órbita do "roda na minha máquina" para "roda na nuvem, acesso de qualquer lugar".

> **Leia isto antes de começar.** A Órbita foi feita *local-first*. Na nuvem, os recursos que dependem da sua máquina mudam:
>
> | Recurso | Local | Na nuvem |
> |---|---|---|
> | Modelos de IA | Ollama (grátis) | provedores de nuvem (Groq/Gemini/OpenAI) |
> | Embedding do RAG | Ollama (nomic) | **precisa de código novo (item R1)** ⚠️ |
> | Voz / wake word | serviço Python local | host à parte, ou desligado |
> | Claude Max | token OAuth pessoal | **não pode** em servidor público (use outro provedor) |
> | Banco | Postgres no Docker | Postgres gerenciado (Neon/Supabase) |
>
> Traduzindo: o **chat, auth, finanças, tarefas, conversas e conectores** sobem e funcionam já. O **RAG (busca nos seus documentos)** só funciona na nuvem depois do ajuste R1. A **voz** precisa de um passo extra.

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

## Etapa 4 — RAG na nuvem (precisa de um ajuste de código) ⚠️

Hoje a busca nos seus documentos (RAG) usa o embedding local do Ollama, que **não existe na Vercel**. Para o RAG funcionar na nuvem, é preciso o item **R1**: trocar o embedding para uma API de nuvem (Gemini `text-embedding-004` ou OpenAI, ambos 768 dimensões, que batem com a coluna do banco) e reindexar o corpus.

**Enquanto R1 não estiver feito:** o chat e as ferramentas funcionam, mas a busca em documentos/memória fica desligada na nuvem. Me peça o R1 quando quiser o RAG na nuvem (é um ajuste focado, condicional à `GEMINI_API_KEY`/`OPENAI_API_KEY`).

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
| **+ RAG** | + item R1 (código) | busca nos seus documentos/memória |
| **+ Voz** | + apps/voice no Render/Fly | STT/TTS/wake word |
| **+ Mobile** | + EAS build | app nas lojas |

**Comece pelo Mínimo** (30 min, tudo grátis). Depois vá ligando os extras. Me chame para o **R1** (RAG na nuvem) e para o **provedor Anthropic por API key** quando quiser esses dois.
