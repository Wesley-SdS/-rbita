---
name: orbita-paridade
description: Verifica que a Órbita continua se comportando igual depois de mover código — extração de packages, migração das rotas para o NestJS, ou qualquer refactor grande. Use durante a migração Next→Nest e sempre que mover módulo de lugar sem querer mudar comportamento.
---

# Verificação de paridade

Regra da migração (ver `BRIEFING-JARVIS.md` §5): **mover código sem mudar comportamento.**
Feature nova entra depois que a paridade estiver verde. Misturar as duas coisas é o jeito mais
rápido de não saber o que quebrou.

## Antes de mover qualquer coisa: fotografe o estado atual

```bash
cd /c/Users/Users/Documents/github/orbita/apps/web
export PATH="/c/ProgramData/nvm/v22.22.3:$PATH"
node ./node_modules/typescript/bin/tsc --noEmit
node ./node_modules/vitest/vitest.mjs run        # baseline: 11 arquivos, 68 testes
```

Se já estiver vermelho antes de você começar, **conserte antes** — não migre sobre base quebrada.

## Camada 1 — mecânica (roda sempre)

```bash
node ./node_modules/typescript/bin/tsc --noEmit
node ./node_modules/vitest/vitest.mjs run
```

A suíte cobre justamente a parte que se move (lógica pura: `compose`, `crypto`, `ssrf`, `chunk`,
`economics`, `llm`, `connectors`, `engine`, `speech`, `service-url`, `auth-origins`). Teste de
lógica pura **sobrevive à mudança de framework intacto** — é o contrato de paridade. Se um teste
precisou mudar para passar, ou o comportamento mudou (não é paridade) ou o teste testava o
framework (arrume o teste, e diga que fez isso).

## Camada 2 — contrato HTTP

Para cada rota migrada, compare **antes e depois**: status code, shape do JSON e headers que a UI
usa. As que mais importam:

| Rota | O que não pode mudar |
|---|---|
| `POST /api/chat` | Stream NDJSON com `{t:"text"\|"tool"\|"tool-done"\|"error"}`; headers `x-conversation-id` e `x-model`; 503 com mensagem acionável quando não há provedor |
| `GET /api/health` | `{status, db, checks:{db,voice,ollama,perception}}` |
| `GET /api/models` | `{models, env, defaultModel}` |
| `POST /api/stt` | IMEDIATO (ditado de comando e app mobile): `{text, language, provider}` + `utterances[]`/`speakers` quando `diarize`. O mobile depende deste formato |
| `POST /api/meeting/transcribe`, `/api/meeting/summarize`, `/api/upload`, `/api/ingest`, `/api/finance/{receipt,statement}`, `identity/{voice,face}?acao=recalcular` | FILA: `202` + `Location: /api/jobs/<id>` + `Retry-After`, corpo já é o status. `200` com `jaExistia: true` quando o mesmo trabalho já estava na fila. Erro de validação continua `400`/`413` na hora |
| `GET /api/jobs/:id` · `DELETE /api/jobs/:id` | Status (`progresso`, `erro`, `resultado` só em `feito`) · pedido de parada |
| `POST /api/tts` | Áudio binário com `Content-Type` certo (Edge devolve `audio/mpeg`, Piper `audio/wav`) |
| `GET/POST/DELETE /api/actions` | Fila e execução — o gate humano não pode afrouxar |
| `/api/auth/*` | **Fica no Next.** Não migrar |

Sem sessão, toda rota responde **401**. Verifique que continua assim:

```bash
for r in models conversations todos actions notifications knowledge memory usage skills mcp; do
  printf "%-16s %s\n" "$r" "$(curl -s -o /dev/null -w '%{http_code}' localhost:3000/api/$r)"
done   # esperado: 401 em todas
```

## Camada 3 — smoke manual (typecheck não pega)

Stream, microfone, WebRTC e MediaRecorder não têm cobertura automática. Depois de mover qualquer
coisa nesses caminhos, teste no app rodando (`/orbita-dev`), logado:

1. **Chat** — mandar mensagem, ver o texto streamar token a token, e o cronômetro correr.
2. **Tool** — pedir "que horas são" e ver o passo de ferramenta aparecer na timeline.
3. **Parar** — clicar em parar no meio da resposta; o texto parcial fica, sem erro na tela.
4. **Voz** — microfone dita no compositor; a resposta é falada; falar por cima interrompe (barge-in).
5. **Reunião** — iniciar, falar, encerrar; conferir transcrição com locutores e resumo.
6. **Conversa** — recarregar a página e reabrir a conversa pelo histórico.

## Camada 4 — o que é fácil quebrar sem perceber

- **Sessão atravessando a fronteira.** O cookie do Better Auth vive no Next. Se o Nest passar a
  atender `/api/*`, ele precisa do token S2S — e `getSession()` (`next/headers`) **não existe**
  do outro lado.
- **Streaming através do proxy.** Um proxy que bufferiza mata o NDJSON: o texto chega de uma vez
  no fim em vez de token a token. Teste olhando, não só pelo status 200.
- **`AbortSignal`.** O barge-in do TTS e o botão parar dependem do abort chegar até o provedor.
- **Cleanup de MCP.** `buildAllTools` devolve um `cleanup()` que fecha as conexões. Com failover
  ele pode ser chamado mais de uma vez — precisa continuar idempotente.
- **Estado em memória vira por-processo.** Rate limit, disjuntor e caches de RAG/embedding são
  `Map`. Com dois processos, cada um tem a sua visão. Não é regressão de paridade, mas registre.
- **Ordem dos chunks do system prompt.** `composeSystem` reemite na ordem de inserção; mudar isso
  muda a resposta do modelo sem quebrar nenhum teste.

## Fechamento

Só declare paridade quando as camadas 1 e 2 estiverem verdes **e** o smoke da camada 3 tiver sido
feito de fato. Se algo ficou de fora, diga qual e por quê — não declare verde por omissão.
