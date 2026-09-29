<div align="center">

# 🪐 ÓRBITA

### Seu assistente pessoal de IA. Local‑first, voz‑primeiro, privado.

Um *Jarvis* pessoal que roda **na sua máquina**: diga **"Ei Órbita"**, converse, e deixe ela agir com os seus dados sem que nada saia do seu computador, a menos que você queira.

<br/>

![Next.js](https://img.shields.io/badge/Next.js-16-000?logo=next.js&logoColor=white)
![NestJS](https://img.shields.io/badge/NestJS-12-e0234e?logo=nestjs&logoColor=white)
![Expo](https://img.shields.io/badge/Expo-SDK%2054-000?logo=expo&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white)
![Postgres](https://img.shields.io/badge/Postgres-pgvector-336791?logo=postgresql&logoColor=white)
![Ollama](https://img.shields.io/badge/Ollama-local-000?logo=ollama&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-22c55e)

<br/>

<img src="docs/login.png" alt="Tela de entrada da Órbita, com o núcleo em WebGL sobre fundo mineral" width="820" />

</div>

---

## ✨ O que é

A **Órbita** é um assistente pessoal de IA construído sobre três princípios:

- **🔒 Local‑first e privado.** Roda no seu hardware com **Ollama**. Um *modo local* força tudo na máquina, e biometria (voz e rosto) nunca sai de casa, por desenho.
- **🗣️ Voz‑primeiro.** Wake word **"Ei Órbita"**, ela fala e ouve. A interface foi pensada para conversa, não só para digitar.
- **🤝 Agente que age.** Memória de longo prazo, RAG sobre os seus documentos, finanças, casa, reuniões e conectores, sempre atrás de um **gate humano** contra prompt‑injection.

E quando você quiser velocidade ou qualidade de nuvem, é **um clique**: troca o provedor no seletor (Claude, Gemini, GPT, Groq, Cohere) sem tocar em código.

> **De um dono só.** A Órbita não é SaaS e não é multi‑tenant. Ela reconhece *pessoas da casa*, com permissão por pessoa e por cômodo (a criança não destranca a porta), mas não tem organizações, cobrança nem revenda.

---

## 🎯 O que ela faz

| | |
|---|---|
| 🧠 **Núcleo (Orb)** | Identidade visual própria: geometria em **WebGL** com vidro, malha neural e giroscópios, em dez estados que contam o que ela está fazendo. Canvas 2D como plano B. |
| 💬 **Conversa com ferramentas** | Chat em streaming com quase **cem ferramentas** em pt‑BR (`registrar_gasto`, `rota`, `enviar_whatsapp`, …), escolhidas por relevância a cada pedido, e failover entre provedores antes do primeiro token. |
| 📚 **RAG + memória** | Busca híbrida (vetor + texto, pgvector) nos seus documentos, com **citação de página** e rerank. Ela aprende com a conversa, **pergunta** quando não tem certeza e liga tudo num **mapa do conhecimento**. |
| 🎙️ **Voz completa** | Wake word (Vosk), STT (faster‑whisper / AssemblyAI), TTS (Edge, Gemini, Piper), conversa em tempo real com **todas as ferramentas** e transcrição de reunião **com diarização**. |
| 📱 **WhatsApp pessoal** | O **seu número**, por uma ponte que roda em casa: ela lê, ouve os áudios, vê as fotos e responde por você, **sempre com aprovação**. Você aprova falando: diz *manda* na conversa com você mesmo. |
| ✈️ **Telegram da Órbita** | O canal **dela**: um bot oficial onde ela fala como ela mesma, com você e com as pessoas da casa, com botões de aprovar. |
| 🌐 **Internet** | Pesquisa (busca nativa do Claude ou uma cadeia de buscadores), cotação de moeda, ação e índice, clima e **rota com o trânsito de agora** até os lugares que você salvou ("quanto tempo até o trabalho?"). |
| 📝 **Reuniões** | Grava, separa quem falou o quê, resume em mapa‑redução e extrai compromissos que viram tarefa. Reunião do **Meet, Teams e Zoom** com transcrição vira resumo sozinha. |
| 👥 **Contatos** | A agenda do Google acha o e‑mail e o WhatsApp de alguém pelo nome, mostra o nome que **você** deu a quem escreve e lembra aniversários. |
| 🏠 **Casa** | Home Assistant como *ferramenta*: cômodos, dispositivos, aparelhos e **risco por domínio** (luz direto, fechadura pelo gate). |
| 👤 **Identidade e câmeras** | Reconhece voz e rosto num serviço **local** de percepção, com consentimento; presença por cômodo e gestos viram **evento**, nunca ação. Acompanha uma tarefa pela câmera ("me ajuda com essa receita"). |
| 💸 **Finanças** | *Posso gastar hoje?*, faturas de cartão, dívidas, parcelas, metas e previsão do mês; lançar falando, pela foto do cupom, pelo boleto ou pelo extrato (CSV/OFX). Painel, chat e voz leem o **mesmo motor**. |
| ✅ **Tarefas** | Com prazo e lembrete na hora ("me lembra às 15h"); o que ficou combinado numa reunião entra sozinho. |
| ⏱️ **Proatividade** | Rotinas, regras, briefing da manhã e aviso antes da reunião, rodando no **processo vivo** (com o navegador fechado), no app, no WhatsApp e no Telegram. |
| 🔌 **Conectores** | Google (Gmail, Agenda, Contatos, Meet), Microsoft (Outlook, Teams), Jira, Notion, Slack e Zoom, com **várias contas por serviço** (lê em todas, escreve em uma). |
| 🛡️ **Gate humano** | O LLM só *propõe* ações com efeito (e‑mail, evento, mensagem); você aprova antes de executar, na tela, falando ou no botão. |
| 🔐 **LGPD** | Exportar todos os dados e apagar a conta; tokens de conectores cifrados em repouso (AES‑256‑GCM). |
| 📊 **Gestão de consumo** | Quanto cada fluxo gastou (chat, voz, WhatsApp, resumos) e quanto você economizou rodando local. |

---

## 🖼️ Telas

<div align="center">
<img src="docs/visao-geral.png" alt="Visão geral da Órbita, com o núcleo e os cartões do dia" width="440" />
&nbsp;&nbsp;
<img src="docs/foco.png" alt="Modo foco, com o núcleo e o temporizador" width="440" />
</div>

<div align="center"><sub>Visão geral · Modo foco</sub></div>

<br/>

<div align="center">
<img src="docs/conversa.png" alt="Tela de conversa da Órbita" width="440" />
&nbsp;&nbsp;
<img src="docs/celular.png" alt="A Órbita no celular" width="200" />
</div>

<div align="center"><sub>Conversa · No celular (PWA instalável)</sub></div>

---

## 🧱 Stack

Monorepo **Turborepo + pnpm**.

```
orbita/
├─ apps/
│  ├─ web/          Next.js 16 · a interface. Só /api/auth e o callback OAuth
│  │                 ficam aqui; o resto de /api é encaminhado
│  ├─ api/          NestJS 12 · o PROCESSO VIVO: cron, event bus, regras,
│  │                 refresh de token e todas as rotas /api          ← obrigatório
│  ├─ mobile/       Expo SDK 54 (iOS/Android)
│  ├─ voice/        Python FastAPI · STT/TTS/wake word locais
│  └─ perception/   Python 3.12 · voz e rosto viram vetor, sem estado,
│                    nunca sai de casa
├─ packages/
│  ├─ core/         domínio puro: chat, RAG, regras, identidade, jobs…
│  ├─ db/           schema Drizzle + migrações
│  └─ llm/          provedores (descoberta · resolver · failover · embeddings)
└─ docker-compose.yml  Postgres + pgvector · GOWA (a ponte do WhatsApp, só em 127.0.0.1)
```

**Origem única:** o navegador só fala com o Next (:3000), que encaminha `/api/*` para o `apps/api` (:3010). Os dois validam a sessão com a **mesma instância** do Better Auth, sem token entre serviços.

- **Interface:** Next.js 16 (Turbopack), React 19, Tailwind v4, Better Auth 1.6
- **Backend:** NestJS 12, rodando de TypeScript com `tsx`
- **IA:** Vercel AI SDK 7, Ollama (Qwen 2.5) + provedores de nuvem OpenAI‑compatible
- **Dados:** Postgres 16 + **pgvector**, Drizzle ORM, índices HNSW cosine
- **Voz:** faster‑whisper · Piper · Vosk · Edge TTS · Gemini TTS · AssemblyAI (opcional)
- **Percepção:** sherpa‑onnx · onnxruntime · MediaPipe
- **Canais:** GOWA (whatsmeow) para o WhatsApp pessoal · Bot API do Telegram
- **Mundo:** Open‑Meteo · AwesomeAPI e Yahoo Finance · Photon, Nominatim e OSRM (OpenStreetMap) · TomTom (trânsito)

---

## 🚀 Rodando localmente

**Pré‑requisitos:** Node 22+, pnpm, Docker e [Ollama](https://ollama.com).

```bash
# 1. dependências
pnpm install

# 2. banco (Postgres + pgvector)
docker compose up -d db

# 3. modelos locais (no host)
ollama pull qwen2.5:3b        # rápido, aguenta CPU
ollama pull nomic-embed-text  # embeddings do RAG

# 4. variáveis de ambiente (o .env da RAIZ, lido pelo api, pelo web e pelo docker compose)
cp .env.example .env            # e preencha (veja abaixo)

# 5. migrações
cd packages/db && npx drizzle-kit migrate && cd ../..
```

Depois, **dois processos**, cada um no seu terminal:

```bash
# o processo vivo (cron, regras, todas as rotas /api)
cd apps/api && npx tsx watch src/main.ts      # :3010

# a interface
cd apps/web && npx next dev -p 3000           # http://localhost:3000
```

> ⚠️ **O `apps/api` não é opcional.** Sem ele, `/api/*` não responde e nada proativo acontece: rotinas e regras rodam ali, não no navegador.

Confira com `curl localhost:3000/api/health` → `{"status":"ok","db":"up"}`.

**Opcionais**, cada um com venv própria:

```bash
cd apps/voice      && ./.venv/Scripts/python.exe -m uvicorn main:app --port 8001
cd apps/perception && ./.venv/Scripts/python.exe -m uvicorn main:app --port 8002
```

Sem a voz, o TTS cai para o navegador e o STT para a nuvem. Sem a percepção, o chat funciona, mas cadastrar e identificar voz ou rosto responde 503.

**WhatsApp pessoal** (opcional): defina `GOWA_BASIC_AUTH` no `.env` da raiz, suba a ponte e pareie o número em *Conexões*:

```bash
docker compose up -d gowa   # só escuta em 127.0.0.1:3011; recusa subir sem a senha
```

**Telegram** (opcional): crie um bot no **@BotFather** e cole o token em *Conexões → Telegram da Órbita*. Não precisa de endereço público.

> 💡 **Sem GPU?** O modelo local fica lento (de 30 s a minutos por resposta). Configure Gemini ou Groq, que têm camada grátis, e a Órbita passa a preferir a nuvem sozinha.

---

## 🔌 Provedores de IA

Tudo é **OpenAI‑compatible** e mora em `packages/llm`. Cada um liga sozinho quando a chave existe no `.env`:

| Provedor | Env | Observação |
|---|---|---|
| ⚡ **Local (Ollama)** | `OLLAMA_BASE_URL` | grátis, privado, roda na máquina |
| 🟠 **Claude Max** | `CLAUDE_CODE_OAUTH_TOKEN` | assinatura, uso pessoal (`claude setup-token`) |
| 🚀 **Groq** | `GROQ_API_KEY` | camada grátis, muito rápido |
| 🔵 **Google Gemini** | `GEMINI_API_KEY` | camada grátis |
| 🟢 **OpenAI** | `OPENAI_API_KEY` | também usada na visão e no tempo real |
| 🟣 **Cohere** | `COHERE_API_KEY` | modelos Command |
| ☁️ **Vercel Gateway** | `AI_GATEWAY_API_KEY` | muitos modelos, uma chave |

O seletor mostra só os provedores configurados. A **ordem do failover** (assinatura → nuvem paga → local) e o modelo pré‑selecionado se ajustam em *Preferências → Modelos*, sem tocar em código.

No modo **automático**, o dia a dia vai para o **modelo preferido** (por padrão o Sonnet 5 da assinatura, rápido e econômico), e o pedido complexo (código, análise, estratégia, texto longo) pode ir para um modelo mais forte, como o Opus. Se o forte bater no limite, só ele pausa: o preferido continua respondendo.

Outros serviços, todos opcionais e acesos pela chave:

| Serviço | Env | Para quê |
|---|---|---|
| 🗺️ TomTom | `TOMTOM_API_KEY` | tempo de rota com o trânsito de agora (grátis, sem cartão) |
| 🔎 Tavily / Brave | `TAVILY_API_KEY` · `BRAVE_SEARCH_API_KEY` | pesquisa na web quando o modelo não é o Claude |
| 🎥 Zoom | `ZOOM_CLIENT_ID` · `ZOOM_CLIENT_SECRET` | transcrição das reuniões gravadas na nuvem |
| 🟦 Microsoft | `MICROSOFT_CLIENT_ID` · `MICROSOFT_CLIENT_SECRET` | Outlook e Teams (app registrado no Azure) |
| ✉️ Google | `GOOGLE_CLIENT_ID` · `GOOGLE_CLIENT_SECRET` | Gmail, Agenda, Contatos e Meet |

---

## 📨 Dois canais, dois papéis

| | **WhatsApp pessoal** | **Telegram da Órbita** |
|---|---|---|
| **De quem é** | O seu número | O número dela (um bot oficial) |
| **Quem fala** | Ela, **como você**, com os seus contatos | Ela, **como ela mesma** |
| **Com quem** | Você (na conversa com você mesmo) e quem te escreve | Você e as pessoas da casa que você convidar |
| **Aprovação** | Tudo que sai para alguém; você diz *manda* | Botões ✅/❌ que só valem os seus |
| **Resposta sozinha** | Só para os contatos que você marcar, sem acesso a nada seu | Não se aplica |

Pelos dois dá para fazer **tudo** que se faz no app: finanças, tarefas, memória, agenda, e‑mail, casa, pesquisa e rota. Mensagem não se perde: o que chega é gravado antes de ser processado, e o que ficou no meio de um reinício é retomado.

As **pessoas da casa** no Telegram falam com a Órbita só sobre o que você liberar (casa, clima, rota…). Elas não veem o seu e‑mail, as suas finanças, a sua agenda nem a sua memória, e toda ação com efeito vira um pedido que **você** aprova.

---

## ⚙️ Configuração sem código

A Órbita não tem constante escondida no código. Cômodos, dispositivos, pessoas, câmeras, modelos, limites, thresholds e regras são **dados**, com tela para editar.

O teste é simples: *"se o dono quiser mudar isso amanhã, ele precisa de um dev?"* Se a resposta for sim, é bug. Tudo vive na tabela `setting`, com padrões sensatos em `packages/core/src/settings/defs.ts` — o app sobe e funciona **sem configurar nada**.

---

## 🛡️ Privacidade e segurança

- **Modo local** força todo o processamento na máquina.
- **Gate de ações com efeito:** o LLM apenas enfileira propostas; nada sai sem a sua aprovação. É defesa **estrutural** contra prompt‑injection, não convenção de prompt.
- **Conteúdo externo é dado, nunca instrução.** E‑mail, página e transcrição são analisados, não obedecidos.
- **Biometria nunca sai de casa:** voz e rosto só trafegam até o serviço local de percepção, e um guard de saída recusa destino que não seja local.
- **Identidade não afirma sem confiança:** presença velha sai como "visto por último", e identificação fraca sai como "provavelmente".
- **Tokens de conectores** cifrados em repouso (AES‑256‑GCM).
- **Canais de mensagem:** quem aprova é o código lendo a fala ou o botão do dono, nunca uma ferramenta; ação perigosa (destrancar, cadastrar pessoa) só pela tela. O destino e o nome no resumo da aprovação são fixados pelo código, não pelo modelo.
- **Fala de terceiros sob controle:** a transcrição das reuniões online e a agenda de contatos só entram quando você liga; a agenda fica só na memória do processo, nunca copiada para o banco.
- **LGPD:** exportar tudo e apagar a conta pela própria interface.
- Rate limiting, guard de SSRF e headers de segurança nas rotas.

---

## 📱 Mobile

O web é **PWA instalável** e responsivo, então o celular já funciona pelo navegador. Há também um app **Expo**:

```bash
cd apps/mobile
npx expo start --lan
```

Abra no **Expo Go**. O app aponta para o backend em `http://<seu-ip>:3000` (configurável em *Ajustes → servidor*).

---

## 🎨 A interface

A identidade se chama **Presença**: superfícies minerais, verde floresta e um núcleo expressivo. Ela nasceu como protótipo independente em `prototypes/orbita-presenca` e o app é **gerado a partir dele**:

```bash
python scripts/portar-presenca.py            # traz folha de estilo, núcleo, ícones e textos
python scripts/portar-presenca.py --conferir # sai com erro se o protótipo andou
```

Os arquivos gerados não se editam à mão. O que é extensão do app (e não existe no protótipo) vive em `apps/web/src/app/presenca-app.css`.

---

## 🗺️ Roadmap

- [x] Chat + RAG híbrido com rerank · voz local + wake word · finanças · conectores · proatividade · LGPD
- [x] Camada de provedores (local + 6 de nuvem) · fila de trabalhos pesados · regras proativas
- [x] Identidade e percepção: voz, rosto, presença por cômodo, gestos e câmeras
- [x] Interface Presença: nove telas, temas mineral e floresta, núcleo em WebGL
- [x] Finanças completas: *posso gastar hoje*, faturas, dívidas, previsão, ditado, boleto e extrato
- [x] WhatsApp pessoal com aprovação falada · Telegram da Órbita com a família
- [x] Internet: pesquisa, cotação, rota com trânsito · contatos do Google · reuniões online (Meet, Teams, Zoom)
- [ ] Google Maps para endereço e trânsito previsto na hora de sair
- [ ] Voz em streaming (STT parcial + TTS em pedaços)
- [ ] CSP/HSTS · OAuth social nativo no mobile

---

## 📄 Licença

[MIT](LICENSE). Feito com carinho para uso pessoal.

<div align="center"><sub>🪐 <b>Órbita</b> · sua IA, na sua órbita.</sub></div>
