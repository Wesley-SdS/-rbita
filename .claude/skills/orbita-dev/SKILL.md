---
name: orbita-dev
description: Sobe a Órbita completa nesta máquina (Postgres, migrações, apps/api, web, serviço de voz e serviço de percepção) e valida a saúde. Use sempre que precisar rodar, reiniciar, testar no app real ou tirar screenshot da Órbita, e quando um comando pnpm/npm falhar com erro de versão do Node.
---

# Subir a Órbita

## A armadilha, antes de tudo

**`pnpm@11.8` exige Node ≥ 22.13 e o Node ativo desta máquina é o 20.20.2.** Qualquer `pnpm ...`
falha com `ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite`. Não tente consertar o pnpm nem instalar nada:
o Node 22 já está na máquina, e as dependências já estão instaladas em `node_modules`.

```bash
export PATH="/c/ProgramData/nvm/v22.22.3:$PATH"   # faça isso em TODO shell novo
node -v                                            # deve dizer v22.22.3
```

Chame os binários direto de `node_modules`, sem pnpm.

## Ordem

```bash
cd /c/Users/Users/Documents/github/orbita
export PATH="/c/ProgramData/nvm/v22.22.3:$PATH"

# 1. Banco (Docker Desktop precisa estar aberto)
docker compose up -d db          # container orbita-db, pgvector, porta 5433

# 2. Migrações (o schema mora em packages/db)
cd packages/db && node ./node_modules/drizzle-kit/bin.cjs migrate

# 3. apps/api — o PROCESSO VIVO (background): cron, event bus, regras e TODAS as rotas /api
cd ../../apps/api
node ./node_modules/tsx/dist/cli.mjs watch src/main.ts     # porta 3010

# 4. Web (background — leva ~15s até "Ready"); encaminha /api/* para o :3010
cd ../web
node ./node_modules/next/dist/bin/next dev -p 3000

# 5. Serviço de voz (background, opcional: STT local, TTS Piper, wake Vosk)
cd ../voice
export VOICE_MODELS_DIR="C:/Users/Users/Documents/github/orbita/apps/voice/models_test"
./.venv/Scripts/python.exe -m uvicorn main:app --host 127.0.0.1 --port 8001

# 6. Serviço de percepção (background, Fase 2: assinatura de voz e rosto, gestos)
cd ../perception
export PERCEPTION_MODELS_DIR="C:/Users/Users/Documents/github/orbita/apps/perception/models"
./.venv/Scripts/python.exe -m uvicorn main:app --host 127.0.0.1 --port 8002
```

O `VOICE_MODELS_DIR` é obrigatório: o default do `main.py` é `/models`, que não existe no Windows.
Os modelos (Piper + Vosk) já estão baixados em `apps/voice/models_test`. A percepção tem o mesmo
problema e o mesmo remédio; os `.onnx` dela vêm de `python scripts/download_models.py` e a venv é
**separada da voz** (3.12, porque o MediaPipe não publica wheel para 3.13). Sem a percepção no ar,
identificar voz e rosto simplesmente não funciona, o resto da Órbita sim.

## Validar

```bash
curl -s localhost:3000/api/health
# esperado: {"status":"ok","db":"up","checks":{"db":"up","voice":"up","ollama":"up","perception":"up"}}
```

`voice: down` só significa que o passo 5 não foi executado — o app funciona sem ele
(TTS cai para Edge/Gemini, STT para AssemblyAI). `perception: down` é o passo 6: o chat continua,
mas cadastrar e identificar voz ou rosto responde 503.

## Entrar no app

`http://localhost:3000` → redireciona para `/login`.
Conta de dev: **`wesley@orbita.local`** / **`Orbita@2026`**

Se a conta não existir (banco recriado), crie por API em vez de pela UI:

```bash
curl -s -X POST http://localhost:3000/api/auth/sign-up/email \
  -H "Content-Type: application/json" -H "Origin: http://localhost:3000" \
  -d '{"name":"Wesley","email":"wesley@orbita.local","password":"Orbita@2026"}'
```

## Verificação antes de fechar tarefa

```bash
cd /c/Users/Users/Documents/github/orbita/apps/web
export PATH="/c/ProgramData/nvm/v22.22.3:$PATH"
node ./node_modules/typescript/bin/tsc --noEmit      # web + packages, precisa sair limpo
node ./node_modules/vitest/vitest.mjs run            # suíte inteira (web, api, packages)
(cd ../api && node ./node_modules/typescript/bin/tsc --noEmit)   # o api tem tsconfig próprio

# Python: voz e percepção têm suíte própria, cada uma na sua venv
(cd ../voice && ./.venv/Scripts/python.exe -m pytest -q)
(cd ../perception && ./.venv/Scripts/python.exe -m pytest -q)
```

## Serviços que já podem estar de pé

Antes de subir, cheque — reiniciar à toa custa ~15s de compilação:

```bash
docker ps --format '{{.Names}}\t{{.Status}}' | grep orbita
curl -s -o /dev/null -w "%{http_code}\n" localhost:3000/api/health
curl -s -o /dev/null -w "%{http_code}\n" localhost:3010/api/health   # apps/api direto
curl -s -o /dev/null -w "%{http_code}\n" localhost:8001/health
curl -s -o /dev/null -w "%{http_code}\n" localhost:8002/health       # percepção
curl -s localhost:11434/api/tags | head -c 200      # Ollama (roda no host)
```

O Ollama é um serviço do Windows e normalmente já está no ar, com `qwen2.5:3b` e `moondream`.

## Notas

- O `next dev` usa Turbopack e faz hot-reload. Depois de editar, **não reinicie** — só recarregue.
- Rota nova compila sob demanda: a primeira chamada leva alguns segundos.
- O log do dev server mostra cada requisição de API em JSON (vem do `middleware.ts`).
- Rota migrada mora no `apps/api`: editar só o `apps/web` não muda nada em `/api/*`.
- Para testar rota autenticada sem o teto de ~30s do proxy do Next em dev:
  `curl -H "Host: localhost:3000" 127.0.0.1:3010/api/... ` com o cookie de sessão.
- Biometria (áudio de cadastro, foto, vetor) só trafega entre `apps/api` e `apps/perception`. Se
  algum teste ou script mandar isso para fora, o guard de saída derruba a requisição de propósito.
