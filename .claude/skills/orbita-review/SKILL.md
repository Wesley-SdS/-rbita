---
name: orbita-review
description: Revisa mudanças na Órbita pelos 8 eixos do projeto (bugs, segurança, privacidade, latência, arquitetura, clean code, testes, contratos). Use ao terminar uma implementação, antes de abrir PR, ou quando o dono pedir revisão de código, review ou "revisa isso".
---

# Code review da Órbita

Adaptado do fluxo de 8 eixos do `adalink-platform`, **sem o que é de plataforma**: aqui não há
multi-tenant, Prisma, microserviço nem RBAC por organização. Em compensação, dois eixos pesam
muito mais: **privacidade** e **latência** — é um assistente que ouve a casa e precisa responder
na hora.

## Escopo

Revise **apenas o diff** (`git diff`, `git diff --staged` ou o alvo indicado). Não audite o
repositório inteiro. Leia o arquivo em volta da mudança para entender o contexto antes de opinar.

## Os 8 eixos

| # | Eixo | O que procurar na Órbita |
|---|---|---|
| 1 | **Bugs e lógica** | `await` faltando, promise não tratada (o padrão do repo é `void` explícito), `AbortSignal` não propagado, cleanup de stream/MediaRecorder/AudioContext, race em `useEffect`, estado preso (ex.: Orb travado em `speaking`) |
| 2 | **Segurança** | Rota sem `getSession()`; query sem filtro de `userId` (IDOR); tool com efeito colateral executando direto em vez de enfileirar em `action_queue`; `fetch` dirigido por LLM sem `safeFetch`/`assertPublicUrl`; segredo em log ou em arquivo versionado; escopo OAuth aumentado sem necessidade |
| 3 | **Privacidade** | Áudio, imagem, transcrição ou embedding indo para a nuvem sem o dono ter escolhido; modo privacidade desrespeitado; captura contínua sem indicador nem retenção definida; PII em log |
| 4 | **Latência** | Trabalho novo no caminho quente do chat ou da voz (antes do primeiro token): query extra, conexão de rede, `await` bloqueante. Comando doméstico e turno de voz são o caso que mais dói. Pergunte: "isso podia ser paralelo, cacheado, ou sair do request?" |
| 5 | **Arquitetura** | Regra de negócio dentro de componente React; rota engordando em vez de delegar para `lib/`; `NextResponse` no lugar de `Response.json`; import do Next dentro de `lib/` (quebra a portabilidade para o Nest); acoplamento novo entre chat e voz que não passe pelas refs-ponte |
| 6 | **Clean code** | Nome descritivo, função pequena, early return, sem duplicação. Comentário explica **por quê**, não o quê. pt-BR acentuado. Sem travessão em texto de usuário |
| 7 | **Testes** | Lógica pura nova em `lib/` sem teste = incompleto. Caminho feliz + ao menos um de erro. Teste apagado para "fazer passar" é reprovação automática |
| 8 | **Contratos** | Zod com limite explícito em toda entrada; status code correto (401 sem sessão, 400 inválido, 413 grande demais, 429 rate limit, 502/503 dependência fora); shape de resposta estável para quem consome (a UI e o mobile) |

## Regras específicas que reprovam na hora

- Tool que **executa** e-mail, evento, mensagem ou ação perigosa de casa direto, sem passar pelo
  `action_queue`. O gate humano é estrutural (ver `CLAUDE.md` §5.1).
- `organizationId`, tenant, billing ou credits chegando via porte do Adalink.
- Diarização aplicada a **pedaços** de um mesmo áudio (os rótulos A/B/C são por requisição).
- Remoção do `assertPublicUrl` para "fazer o Home Assistant funcionar". A resposta certa é uma
  exceção explícita e estreita para a LAN, não desligar a defesa.
- `console.log` em código de servidor novo (use `lib/observability/logger.ts`).

## Saída

Ordene por severidade. Para cada achado:

```
[eixo] arquivo.ts:linha
O problema em uma frase.
Como falha: entrada/estado concreto → resultado errado.
Sugestão: o que fazer.
```

Se não houver achado real, diga isso em uma linha. **Não invente problema para parecer útil** —
mas também não deixe passar nada dos "reprovam na hora" acima.

Ao final, rode a verificação mecânica antes de dar o veredito:

```bash
cd apps/web && export PATH="/c/ProgramData/nvm/v22.22.3:$PATH"
node ./node_modules/typescript/bin/tsc --noEmit
node ./node_modules/vitest/vitest.mjs run
```
