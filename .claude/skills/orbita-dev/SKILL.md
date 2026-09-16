---
name: orbita-dev
description: Sobe a Órbita completa nesta máquina (Postgres, migrações, web, serviço de voz) e valida a saúde. Use sempre que precisar rodar, reiniciar, testar no app real ou tirar screenshot da Órbita, e quando um comando pnpm/npm falhar com erro de versão do Node.
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

# 2. Migrações
cd apps/web && node ./node_modules/drizzle-kit/bin.cjs migrate

# 3. Web (background — leva ~15s até "Ready")
node ./node_modules/next/dist/bin/next dev -p 3000

# 4. Serviço de voz (background, opcional: STT local, TTS Piper, wake Vosk)
cd ../voice
export VOICE_MODELS_DIR="C:/Users/Users/Documents/github/orbita/apps/voice/models_test"
./.venv/Scripts/python.exe -m uvicorn main:app --host 127.0.0.1 --port 8001
```

O `VOICE_MODELS_DIR` é obrigatório: o default do `main.py` é `/models`, que não existe no Windows.
Os modelos (Piper + Vosk) já estão baixados em `apps/voice/models_test`.

## Validar

```bash
curl -s localhost:3000/api/health
# esperado: {"status":"ok","db":"up","checks":{"db":"up","voice":"up","ollama":"up"}}
```

`voice: down` só significa que o passo 4 não foi executado — o app funciona sem ele
(TTS cai para Edge/Gemini, STT para AssemblyAI).

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
node ./node_modules/typescript/bin/tsc --noEmit      # precisa sair limpo
node ./node_modules/vitest/vitest.mjs run            # 11 arquivos, 68 testes
```

## Serviços que já podem estar de pé

Antes de subir, cheque — reiniciar à toa custa ~15s de compilação:

```bash
docker ps --format '{{.Names}}\t{{.Status}}' | grep orbita
curl -s -o /dev/null -w "%{http_code}\n" localhost:3000/api/health
curl -s -o /dev/null -w "%{http_code}\n" localhost:8001/health
curl -s localhost:11434/api/tags | head -c 200      # Ollama (roda no host)
```

O Ollama é um serviço do Windows e normalmente já está no ar, com `qwen2.5:3b` e `moondream`.

## Notas

- O `next dev` usa Turbopack e faz hot-reload. Depois de editar, **não reinicie** — só recarregue.
- Rota nova compila sob demanda: a primeira chamada leva alguns segundos.
- O log do dev server mostra cada requisição de API em JSON (vem do `middleware.ts`).
