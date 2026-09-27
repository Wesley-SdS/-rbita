# PRD — A ÓRBITA SEM OLLAMA

> Tirar o modelo local do caminho crítico da Órbita e passar **tudo que é LLM** para a assinatura,
> mantendo o Ollama como opção de quem quer privacidade total, nunca como o padrão e nunca como
> queda silenciosa.
>
> Versão 1, de 2026-09-27. Escrito depois de uma varredura completa do código e **medido no banco
> de dados desta máquina** (`usage_event`, `camera_event`). Tudo em "Estado de partida" foi
> verificado, não presumido. Decisões do dono estão marcadas como **DECIDIDO**.

---

## 1. Por que este PRD existe

A Órbita nasceu local-first, e isso foi a decisão certa: ela funciona sem nuvem, sem chave e sem
conta. O que mudou não foi o princípio, foi a realidade medida desta casa.

**Esta máquina não tem GPU.** O `qwen2.5:7b` na CPU não é lento, é inviável, e enquanto ele gera a
VM inteira engasga (CLAUDE.md §9). Os números vêm do `usage_event` do dono, não de estimativa:

| fluxo | no modelo local | na assinatura | diferença |
|---|---|---|---|
| resumo de reunião | 123,6 s e 126,2 s | 4,5 s a 9,6 s | **18x a 27x** |
| extração de memória | 87,6 s | 3,4 s | **26x** |
| chat (um turno) | 186,8 s | 2,5 s | **75x** |
| visão de câmera | 61,1 s, e resposta imprestável (`!!!`) | 3,7 s a 8,5 s | **8x a 16x** |
| rotina proativa | **980 s e falhou** (3 tentativas, Ollama desligado) | não chegou a tentar | infinito |

Aquela última linha é o resumo do problema. Com o Ollama fora do ar, a rotina não caiu para a
assinatura que estava ali, configurada e de graça: ela insistiu no local por **16 minutos** e
desistiu. O modelo local não estava sendo uma reserva, estava sendo um buraco.

**E na nuvem não existe Ollama.** Quando a Órbita subir na Render, todo caminho que hoje termina em
"cai para o local" termina em "não funciona". Hoje isso é invisível porque a máquina de casa sempre
teve o Ollama por perto.

### O que este PRD NÃO é

Não é "apagar o modelo local". A opção continua inteira, por três razões:

1. **Privacidade é escolha do dono**, não do código. Quem quiser que um extrato bancário nunca saia
   de casa tem de continuar podendo (`ocr.visionProvider: local`, `embeddings.provider: local`).
2. **Uma casa com GPU muda a conta.** O mesmo `qwen2.5:7b` numa placa decente responde em segundos,
   e aí o local é a melhor opção, não a pior.
3. **§5.7: capacidade cresce, nunca some.** Tirar o local do padrão é configuração; tirar do código
   é perda.

---

## 2. Decisões do dono

| Tema | Decisão |
|---|---|
| Quem atende por padrão | **DECIDIDO:** "quando eu escolho assinatura, tudo que roda IA deve usar assinatura" |
| IA própria de terceiro | **DECIDIDO:** exceção à regra acima. AssemblyAI (transcrição) é a IA dela mesma, não um LLM que a Órbita escolhe |
| Câmera com identificação | **DECIDIDO (27/09):** segue a preferência de visão (assinatura/nuvem), não é mais presa ao local |
| Modelo local | **DECIDIDO:** continua existindo como opção, sai do padrão e sai de toda queda automática |
| Biometria | **NÃO MUDA:** §5.4.1 continua absoluta. Rosto e voz só vão ao `apps/perception` local |

---

## 3. Estado de partida (verificado no código em 2026-09-27)

### 3.1 Os oito pontos que falam com o Ollama

| Onde | Para quê | Situação |
|---|---|---|
| `packages/llm/src/discovery.ts:101` | lista os modelos instalados (`/api/tags`) | tenta sempre, mesmo com o dono em assinatura |
| `packages/llm/src/providers.ts:28` | `resolveModel`, ramo local | ok (só atende quem pediu local) |
| `packages/llm/src/providers.ts:244` | `resolveVisionModel`, último da fila | ok (fecha a fila, não abre) |
| `packages/llm/src/embeddings.ts:44` | embedding local | **o caminho padrão hoje** |
| `packages/llm/src/failover.ts:97` | `ollamaUp()`, ping | ok |
| `packages/llm/src/catalog.ts:147` | `localAvailable()` | **só protege a Vercel**, não a Render |
| `packages/llm/src/failover.ts:216` | cadeia vazia empurra o bootstrap local | **último recurso que não existe na nuvem** |
| `apps/api/src/routes/health.ts:33` | `ollama: up/down` | mostra "down" como falha mesmo sem ninguém usar |

### 3.2 O que aponta para o local por padrão

| Chave / constante | Valor de hoje | Escapa por |
|---|---|---|
| `BOOTSTRAP_MODEL_KEY` (`policy.ts:37`) | `local/qwen2.5:7b` | env `ORBITA_FALLBACK_MODEL` |
| `llm.fallbackModel` | `""`, ou seja o bootstrap acima | Ajustes |
| `embeddings.provider` | `auto` (nuvem se houver chave) | Ajustes |
| `embeddings.localModel` | `nomic-embed-text-v2-moe` | Ajustes / env `EMBED_MODEL` |
| `vision.localModel` | `moondream` | Ajustes |
| `ocr.visionProvider` | `auto`, que cai para **local** sem chave | Ajustes |
| `rag.rerank` | `nenhum` (o local é opção, e não é Ollama) | Ajustes |
| `chat.summaryModel`, `routines.model`, `memory.extractModel` | `""` | Ajustes |
| `llm.defaultPreference` | `nuvem` | já está do lado certo |

### 3.3 O que já foi corrigido antes deste PRD (não refazer)

| Correção | Onde | Evidência |
|---|---|---|
| Visão passa a aceitar assinatura | `providers.ts` (`ProvedorDeVisao`) | `visao-assinatura` em 4,3 s no `usage_event` |
| Câmera com identificação segue a preferência | `cameras/narrate.ts` (`soLocalParaCamera`) | commit `f740444` |
| Tarefa da casa segue a ordem do dono | `llm/gerar.ts` (`candidatosDaCasa`) | `resumo_reuniao` migrou de 126 s local para 6,9 s Claude |
| Acompanhamento pela câmera seguia o local | `guided/watch.ts` | usava `cam.identifyFaces` cru, por fora de `soLocalParaCamera` |

### 3.4 O que NÃO é Ollama e não entra aqui

Fácil de confundir, e confundir levaria a mexer no que está certo:

- **`apps/perception` (:8002)** — rosto, voz, gestos. Local **por decisão** (§5.4.1), e o guard de
  saída recusa destino que não seja de casa. Não é dívida, é a regra.
- **`apps/voice` (:8001)** — whisper local (reserva do STT), Piper (TTS), Vosk (wake word). Serviço
  Python próprio, nada a ver com Ollama. Entra no PRD só como nota de deploy.
- **AssemblyAI** — decisão do dono: é a IA dela mesma.
- **tesseract.js** — OCR em CPU, no próprio `apps/api`. Não é LLM.
- **silero-vad / onnxruntime-web** — detector de fala no navegador, já fail-soft.
- **reranker local** (`@huggingface/transformers`) — ONNX dentro do `apps/api`, não Ollama.

---

## 4. Escopo, item por item

Cada item traz **estado**, **alvo**, **como** e **aceite**. A ordem das ondas está na §5.

### E1. O bootstrap deixa de ser local

**Estado.** `BOOTSTRAP_MODEL_KEY = process.env.ORBITA_FALLBACK_MODEL ?? "local/qwen2.5:7b"`, usado
em três lugares: `fallbackModelKey()`, `escolherPadrao()` como última saída e `failover.ts:216`
quando a cadeia fica vazia. Numa instalação sem Ollama, os três apontam para um modelo inexistente.

**Alvo.** O reserva é **derivado do que a casa tem**, não uma constante. Sem descoberta nenhuma
(primeiro boot), o reserva é o primeiro provedor que responde pela ordem do dono; se absolutamente
nada responder, o erro diz o que fazer em vez de tentar uma chave quebrada.

**Como.**

- `BOOTSTRAP_MODEL_KEY` passa a ser `""` por padrão, e a env continua valendo para quem quer fixar.
- `failover.ts:216`: cadeia vazia devolve vazio, e quem chama produz
  "Nenhum modelo disponível: configure uma chave em Ajustes, Modelos, ou suba o Ollama."
- `llm.fallbackModel` ganha ajuda dizendo que vazio significa "a ordem do dono decide", não "o
  local".

**Aceite.** Com `OLLAMA_BASE_URL` numa porta morta e uma chave de nuvem configurada, nenhum fluxo
(chat, rotina, memória, resumo, extrato, visão) tenta o local em nenhuma tentativa. Verificação:
subir com o Ollama desligado e conferir que `usage_event` não tem linha `provider = 'local'`.

---

### E2. Embeddings: a dependência mais séria

**Estado.** `embeddings.provider: auto` usa nuvem quando há chave e **local quando não há**. O
modelo padrão é o `nomic-embed-text-v2-moe` do Ollama. Sem Ollama e sem chave, o RAG inteiro (busca
nos documentos, memória, skills) não indexa nem busca. `DEPLOY.md:112` já registra isso.

**Atenção, e isto muda o desenho:** a **assinatura do Claude não serve para embedding**. A Anthropic
não tem endpoint de embeddings. Então "tudo na assinatura" não se aplica aqui: embedding de nuvem
significa **Gemini** (`gemini-embedding-2`, grátis no free tier, normaliza sozinho ao truncar para
768) ou **OpenAI** (`text-embedding-3-small`, reduzível para 768). É o único item do PRD em que a
palavra "assinatura" não resolve, e é melhor saber disso agora do que na onda 4.

**Alvo.** Embedding de nuvem por padrão quando houver chave de embedding, e o estado do acervo
**visível**: quem indexou com um modelo e trocou para outro precisa saber que a busca ficou cega.

**Como.**

- `embeddings.provider` ganha as opções explícitas `gemini` e `openai` (hoje é só `cloud`
  genérico), e a ajuda diz que a assinatura do Claude não atende embedding.
- Gravar, junto de cada vetor, **qual modelo o gerou** (coluna `embed_model`). Sem isso, "trocar o
  provedor invalida os vetores" é um aviso de tela que ninguém obedece, e a busca passa a comparar
  espaços vetoriais diferentes em silêncio.
- A tela do acervo mostra "X trechos com `nomic-embed-text-v2-moe`, Y com `gemini-embedding-2`" e
  oferece **Reindexar** (o job já existe).
- A busca **ignora** vetor de modelo diferente do ativo em vez de comparar: resultado errado é pior
  que resultado a menos.

**Aceite.** Numa instalação sem Ollama e com `GEMINI_API_KEY`, indexar um PDF e buscar nele funciona
do zero. Com vetores antigos de outro modelo no banco, a busca não os mistura e a tela diz quantos
faltam reindexar.

**Risco.** É o item mais caro do PRD (migração, job e tela). Se precisar cortar algo, corte a coluna
`embed_model` **por último**: sem ela, o resto é maquiagem.

---

### E3. A descoberta não procura o que o dono não quer

**Estado.** `discoverModels()` bate no Ollama a cada renovação (padrão 5 min), mesmo com o dono em
"assinatura primeiro" e sem nenhum modelo local no catálogo. Com o Ollama desligado, cada rodada
paga o timeout.

**Alvo.** A descoberta só procura o local quando o local pode ser escolhido.

**Como.** Nova chave `llm.descobrirLocal` (`auto` · `sempre` · `nunca`, padrão `auto`). Em `auto`,
procura só se `llm.failoverOrder` puser o local antes de alguma nuvem, ou se
`llm.defaultPreference` for `local`. `nunca` é o modo Render.

**Aceite.** Com o dono em assinatura e `descobrirLocal: auto`, nenhuma requisição sai para `:11434`.

---

### E4. `localAvailable()` protege qualquer nuvem, não só a Vercel

**Estado.** `localAvailable()` devolve falso **só** quando existe `process.env.VERCEL` e a URL é
localhost. Na Render devolve verdadeiro, então o filtro `if (m.local && !localAvailable()) continue`
não filtra nada lá. Hoje não dói porque sem Ollama a descoberta não acha modelo local para filtrar,
mas o último recurso do E1 passa por aqui.

**Alvo.** A pergunta certa não é "estou na Vercel?", é "existe Ollama alcançável daqui?".

**Como.** Considerar qualquer sinal de ambiente gerenciado (`VERCEL`, `RENDER`, `FLY_APP_NAME`,
`K_SERVICE`) **ou** uma chave explícita `llm.localDisponivel` (`auto` · `sim` · `nao`). Zero
hardcode: quem manda é o dono.

**Aceite.** Com `RENDER=1` e `OLLAMA_BASE_URL` em localhost, modelo local não aparece em cadeia
nenhuma, nem como último recurso.

---

### E5. OCR de página não cai para o local sem avisar

**Estado.** `ondeLer()` (`ocr/visao.ts:40`): `auto` e **`nuvem`** caem para `local` quando não há
chave de nuvem. Sem chave e sem Ollama, o reforço de leitura simplesmente não acontece, em
fail-soft, e fica só o que o tesseract leu.

**Alvo.** `nuvem` sem chave é **erro dito**, não queda silenciosa para um caminho que talvez não
exista. A assinatura conta como chave de nuvem aqui (já conta em `temChaveDeNuvem()`).

**Como.** `ondeLer` devolve `null` com motivo quando `nuvem` foi pedido e não há chave, e o job de
indexação registra isso no resultado da página em vez de engolir.

**Aceite.** Teste puro novo: `ondeLer("nuvem", false)` não devolve `"local"`.

---

### E6. Saúde e tela param de chamar o Ollama de "falha"

**Estado.** `/api/health` reporta `ollama: down` e a tela pinta vermelho, mesmo numa instalação que
escolheu não usar o local. Isso treina o dono a ignorar o painel de saúde, que é o pior resultado
possível para um painel de saúde.

**Alvo.** Serviço que ninguém usa aparece como **não usado**, não como `down`.

**Como.** `health.ts` lê `llm.descobrirLocal` e `llm.localDisponivel` e devolve
`ollama: "nao_usado" | "up" | "down"`. Mesmo tratamento para `voice` quando o TTS está em `edge-tts`
e a wake word em Web Speech.

**Aceite.** Com o dono em assinatura e Ollama desligado, `/api/health` devolve `status: "ok"`.

---

### E7. Reranker do RAG: dizer a verdade sobre o que ele é

**Estado.** `rag.rerank` tem `nenhum` (padrão), `local` (ONNX em CPU, **não** Ollama) e `cohere`
(chave própria). O rótulo "local" faz o dono presumir Ollama e evitar justamente a opção que não
depende dele.

**Alvo.** Nenhuma mudança de comportamento. A tela passa a dizer que aqui "local" é ONNX dentro do
`apps/api` e funciona sem Ollama.

**Aceite.** Texto de ajuda revisado, comportamento idêntico.

---

### E8. Deploy: dizer o que existe e o que não existe

**Estado.** `DEPLOY.md` cobre o RAG (item R1) e a voz, e não cobre o resto.

**Alvo.** Uma tabela única de "o que muda na nuvem", derivada da §3 deste PRD, separando o que
precisa de host próprio (`apps/voice`, `apps/perception`) do que simplesmente não existe (Ollama).

**Aceite.** Quem for subir na Render não descobre um item faltando pelo erro em produção.

---

## 5. Ordem de execução

Cada onda fecha com os portões do §7 do CLAUDE.md (`tsc` limpo nos dois apps, `vitest` verde).

| Onda | Itens | Por que nesta ordem |
|---|---|---|
| **1** | E1, E4 | São os dois que fazem a Órbita tentar um modelo inexistente. Tudo o mais fica mais fácil de testar depois deles |
| **2** | E3, E6 | Baratos, e tiram o ruído (timeout e painel vermelho) que atrapalha medir as ondas seguintes |
| **3** | E5, E7 | Localizados, sem migração |
| **4** | E2 | O maior. Migração, job e tela. Deixado por último de propósito: até aqui o dono já roda sem Ollama em tudo menos RAG |
| **5** | E8 | Documentação, derivada do que de fato ficou |

---

## 6. Armadilhas (já pagas, não repetir)

- **A ordem do dono só vale se ninguém passar um modelo "pedido" por baixo.** `buildModelChain` põe
  o modelo pedido em PRIMEIRO lugar. Foi assim que o bootstrap local virou a escolha de rotina,
  memória e resumo: o código passava o reserva como se fosse pedido. Quem mexer em seleção de
  modelo passa por `candidatosDaCasa` (`llm/gerar.ts`) e não reinventa.
- **Tool antiga fura regra nova** (CLAUDE.md §9). `casa_ver_camera` e `ver_camera` fazem a mesma
  coisa, e `guided/watch.ts` fazia uma terceira. Regra nova entra em TODAS, ou a escolha do modelo
  vira o buraco.
- **Trocar embedding invalida vetor gravado, e o aviso na tela não impede nada.** Sem a coluna do
  modelo, o banco fica com dois espaços vetoriais misturados e a busca piora em silêncio.
- **`generateObject` não funciona contra Ollama.** Se um dia o local voltar ao caminho, continua
  valendo `generateStructured`. Não remover.
- **Modelo local satura a VM inteira** enquanto gera. Ao medir uma onda, não comparar tempo de rota
  HTTP com uma geração local em curso: o número sai contaminado.
- **"Assinatura" não é provedor de tudo.** Ela atende chat, tools e visão; **não** atende embedding
  e não atende transcrição.

---

## 7. Aceite da fase

1. **`OLLAMA_BASE_URL` numa porta morta, com chave de nuvem configurada:** chat, rotinas, regras,
   resumo de reunião, extração de memória, leitura de comprovante, visão de câmera, acompanhamento
   por câmera e RAG (indexar e buscar) funcionam, todos.
2. **`usage_event` sem nenhuma linha `provider = 'local'`** num dia de uso normal com o dono em
   "assinatura primeiro".
3. **`/api/health` devolve `ok`** nessa configuração.
4. **Quem escolhe `local` explicitamente** em `embeddings.provider` e `ocr.visionProvider` continua
   com o comportamento local íntegro, e a tela diz que depende do Ollama.
5. **§5.4.1 intacta:** os testes `privacy/no-leak*.test.ts` continuam verdes, e nenhum vetor
   biométrico passou a sair de casa.
6. **Nenhuma tool removida** (§5.7).
