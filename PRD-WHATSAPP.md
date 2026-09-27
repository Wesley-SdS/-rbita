# PRD — WHATSAPP PESSOAL NA ÓRBITA

> A Órbita lê o WhatsApp pessoal do dono, entende texto, áudio e imagem, e responde por ele em
> texto, áudio ou imagem. Toda resposta a outra pessoa passa por aprovação, que pode ser dada pela
> tela, pelo próprio WhatsApp ou por voz. Contatos escolhidos pelo dono podem ser respondidos
> sozinhos, com a Órbita cega para o resto da vida dele.
>
> Versão 1, de 2026-09-27. O estado de partida foi verificado no código da Órbita e no
> `../whatsapp-workspace`, não presumido. Decisões do dono estão marcadas como **DECIDIDO**.

---

## 1. Por que este PRD existe

O WhatsApp é o canal de comunicação principal do dono e é o único dos quatro focos (reuniões,
casa, finanças, canais) em que a Órbita hoje é quase cega. O que existe é a Cloud API da Meta, que
**só envia texto** e só funciona com número Business: não recebe nada, não guarda nada, não ouve
áudio, não vê imagem.

O MCP que a Meta lançou em setembro de 2026 (WhatsApp Business Tools MCP) não muda isso: ele
configura a WhatsApp Business Platform (cadastrar número, template, webhook). Não lê conversa
pessoal. Além disso, tool que entra por MCP passa por fora do registro, sem risco declarado e sem
gate (§5.1, §5.7), então nem uma ponte comunitária por MCP serviria.

### O que este PRD NÃO é

- **Não é o `whatsapp-workspace`.** Aquele projeto é uma plataforma de atendimento multi-tenant
  (organização, equipe, fila, campanha). Daqui só se porta o que fala com o GOWA. Nada de
  organização, papel de atendente, campanha ou funil (§5.5).
- **Não é remover a Cloud API.** `enviar_whatsapp` e o cadastro de token continuam (§5.7). O
  provedor vira escolha do dono.
- **Não é disparo em massa.** A Órbita responde conversas; puxar conversa com número que nunca
  escreveu passa por aprovação humana sempre, inclusive no modo automático.

---

## 2. Decisões do dono

| Tema | Decisão |
|---|---|
| Qual número | **DECIDIDO (27/09):** o número pessoal, via ponte local, ciente do risco de banimento |
| Motor da ponte | **DECIDIDO (27/09):** GOWA (REST sobre whatsmeow), o mesmo do `whatsapp-workspace`. Evolution e WAHA NOWEB usam Baileys, que perde sessão e vaza memória |
| O projeto `whatsapp-workspace` | **DECIDIDO (27/09):** não roda junto. É referência de onde portar peças testadas |
| Aprovação | **DECIDIDO (27/09):** toda resposta a outra pessoa pede aprovação por padrão |
| Aprovar dirigindo | **DECIDIDO (27/09):** a aprovação tem de poder ser dada sem tela (pelo WhatsApp e por voz) |
| Responder sozinha | **DECIDIDO (27/09):** existe, desligado por padrão, liberado **contato a contato**, e nesse modo a Órbita não enxerga nada pessoal |
| Consulta do dono | **DECIDIDO (27/09):** perguntar algo à Órbita ("consigo abastecer 100 reais?") nunca pede aprovação, nem pelo WhatsApp |

---

## 3. Estado de partida (verificado em 2026-09-27)

### 3.1 O que a Órbita já tem

| Peça | Onde | Serve como está? |
|---|---|---|
| Envio de texto pela Cloud API | `packages/core/src/connectors/whatsapp.ts` (`sendWhatsApp`, URL da Meta fixa) | Vira um dos dois provedores |
| Tool `enviar_whatsapp` (`efeito_externo`, `requires.whatsapp`) | `packages/core/src/tools/domains/whatsapp.ts` | Continua; passa a usar o provedor ativo |
| Cadastro de token pela tela | `whatsapp_connection` · `routes/channels-whatsapp.ts` · `BlocoWhatsapp` em `connectors-panel.tsx:173` | Continua para a Cloud API |
| Ação de regra `whatsapp` (sempre enfileira) | `rules/engine.ts:53` · `rules/run.ts:138` | Continua |
| Gate derivado do risco | `toToolSet` em `tools/registry.ts:234`; cópia para realtime em `tools/index.ts:150` | Base de tudo |
| Fila de aprovação | `action_queue` (sem coluna de canal nem validade) · `POST /api/actions` · `connectors/execute.ts` | Ganha canal e validade |
| Fila de trabalho pesado | `packages/core/src/jobs/` | Processa o webhook fora da requisição |
| Event bus com outbox | `events.emit(type, payload, { userId })` | Evento de mensagem nova |
| STT | `transcribeRecording` em `meetings/transcribe.ts:36` | Transcreve áudio recebido |
| Visão | `narrateSnapshot` em `cameras/narrate.ts:59` | Descreve imagem recebida |
| Turno de LLM fora do HTTP | `runPromptForUser` em `routines/run.ts:37` | **Não serve direto:** sem histórico, sem seleção por relevância, sem restrição de tools |
| TTS | `synthesizeEdge`/`synthesizeGemini` no core; **Piper e a cadeia inteira só dentro de `routes/tts.ts`** | Precisa ir para o core |
| Cliente de serviço local | padrão em `perception/client.ts` (URL por config, `isLocalUrl`, timeout) | Molde do cliente do GOWA |

### 3.2 O que NÃO existe

- **Aprovação por voz ou por conversa.** Só existe botão na tela (`actions-panel.tsx`,
  `presenca/atividade.tsx`). O prompt manda o modelo dizer "deixei pronto para você aprovar".
- **Webhook com HMAC.** O único webhook de entrada é `camera-ingest.ts`, com token no corpo. Não há
  `timingSafeEqual` no repo.
- **Tabela de mensagem externa.** O gmail-watch só guarda cursor.
- **Conversão para OGG/Opus.** Nota de voz do WhatsApp é OGG/Opus; o Piper gera WAV e o Edge, MP3.
  O `apps/voice` já tem `ffmpeg` no Dockerfile.
- **Restrição de tools por nome.** `buildAllTools` filtra por domínio (`dominios`), não por lista.

### 3.3 O que se porta do `whatsapp-workspace`

| Peça de lá | Vira aqui | Teste que vem junto |
|---|---|---|
| `infrastructure/gowa/gowa.client.ts` (Basic auth, `X-Device-Id`, três formas de "não pareado") | `packages/core/src/whatsapp/gowa/client.ts` | `gowa-sessao.spec.ts` |
| `gowa-provider.adapter.ts` (parear, status, enviar texto/mídia, baixar mídia) | `whatsapp/gowa/provider.ts` | `gowa-media-download.spec.ts` |
| `packages/contracts/src/gowa-events.ts` (zod do envelope e dos eventos) | `whatsapp/gowa/eventos.ts` | `contratos.spec.ts` (parte GOWA) |
| `webhook-signature.ts` (HMAC-SHA256 sobre bytes crus, `x-hub-signature-256`) | `whatsapp/gowa/assinatura.ts` | `webhook-signature.spec.ts` |
| `gowa-message.translator.ts` | `whatsapp/traduzir.ts` | `gowa-message.translator.spec.ts` |
| `domain/antiban/outbound-policy.ts` | `whatsapp/antiban.ts`, números viram config | `outbound-policy.spec.ts` |
| `domain/health/health-policy.ts` (reconexão, banido) | `whatsapp/saude.ts` | `health-policy.spec.ts` |

Ao portar: tirar `organizationId`, Prisma, BullMQ e MinIO. Persistência vira Drizzle, fila vira
`jobs/`, mídia vira disco local.

---

## 4. Arquitetura

```
 celular do dono ──(WhatsApp)── GOWA (Docker, 127.0.0.1:3001, sessão em volume)
                                   │ webhook assinado (HMAC por sessão)
                                   ▼
 apps/api  POST /api/whatsapp/webhook ── verifica ── grava bruto ── 200
                                   │ enqueueJob("whatsapp.processar")
                                   ▼
 jobs: traduz ─ baixa mídia ─ transcreve áudio ─ grava wa_mensagem ─ emite whatsapp.mensagem_recebida
                                   │
            ┌──────────────────────┼─────────────────────────────┐
            ▼                      ▼                             ▼
   conversa "Eu" (dono)    contato em modo automático      qualquer outro
   turno completo,         turno restrito: só esta         só guarda; regras
   todas as tools          conversa, só responder nela     podem avisar o dono
```

Três canais, três níveis de confiança. Quem decide o nível é o **chat de origem**, determinado pelo
código, nunca pelo modelo.

| Canal | Quem fala | Tools | Resposta nesse chat | Resposta a terceiros |
|---|---|---|---|---|
| Conversa "Eu" (mensagem para si mesmo) | o dono | todas (seleção por relevância) | direta | gate |
| Contato em modo automático | terceiro liberado | só as da conversa dele | direta, com teto | **impossível** |
| Qualquer outro chat, grupo, status | terceiro | nenhuma (nenhum turno roda) | não há | não há |

---

## 5. Escopo, item por item

### W0. Sondagem antes de escrever código

O GOWA tem OpenAPI incompleto e o `whatsapp-workspace` nunca testou mídia, reação nem download
contra um número pareado. Antes de W1, com um número de teste pareado, medir e anotar em
`docs/whatsapp-gowa.md`:

1. **O container alcança o `apps/api`?** O Nest escuta só em `127.0.0.1` (`main.ts:57`). No Docker
   Desktop, `host.docker.internal` pode não chegar num bind de loopback. Se não chegar, a saída é
   rodar o GOWA fora do Docker (binário Go) ou abrir o bind só para a rede do Docker. Não abrir
   para a LAN.
2. **Como chega a conversa "Eu"?** Esperado: `chat_id` igual ao JID do próprio número e
   `is_from_me: true`. Conferir também o formato LID (`from_lid`), que o workspace ignora.
3. **`/send/audio` vira nota de voz (ptt) e converte o formato?** Mandar WAV, MP3 e OGG/Opus e ver
   qual chega como nota de voz tocável no celular.
4. **Download de mídia:** o `path` do payload e o `/message/{id}/download`, com `X-Device-Id`.
5. **Versão:** fixar a tag da imagem (o workspace usa `:latest`, e os comentários citam versões
   diferentes).

**Aceite:** o documento existe e cada item tem a resposta medida.

### W1. Infra, provedor e pareamento

- **Docker:** serviço `gowa` no `docker-compose.yml`, porta `127.0.0.1:3001:3000` (nunca
  `0.0.0.0`), volume próprio para `/app/storages`, `restart: unless-stopped`, tag fixada em W0.
  Credencial Basic em `GOWA_BASIC_AUTH` no `.env` (gerada; `admin:admin` só no exemplo).
- **Config** (`defs.ts`, com tela):
  - `whatsapp.provedor`: `pessoal` · `cloud` (padrão `pessoal` se houver sessão pareada, senão `cloud`
    se houver token, senão nenhum)
  - `whatsapp.ponteUrl`: padrão `http://127.0.0.1:3001`, validado com `isLocalUrl` como a percepção.
    A ponte carrega a conta inteira do dono: **nunca** aceitar URL fora de casa.
- **Tabela `wa_sessao`**: `userId` (único, cascade), `deviceId`, `webhookSegredoEnc` (AES-GCM,
  `randomBytes(32)`, por sessão como no workspace), `jid`, `status`
  (`desconectado|pareando|conectado|banido`), `pareadoEm`, `atualizadoEm`.
- **Rotas** (`OwnerGuard`): `GET /api/whatsapp/sessao` (status), `POST /api/whatsapp/parear`
  (`{modo: "qr"}` devolve o PNG como data URL, proxiado porque o link do GOWA é interno e tem auth;
  `{modo: "codigo", telefone}` devolve o código de 8 dígitos, válido por 60 s), `POST
  /api/whatsapp/desconectar`.
- **Saúde:** o `SchedulerService` consulta o status a cada `whatsapp.saudeIntervalo` (padrão 60 s),
  grava mudança só quando muda, e emite `whatsapp.sessao_caiu` / `whatsapp.sessao_voltou`.
  `/api/health` ganha `whatsapp: up|down|off`.
- **Tela:** bloco "WhatsApp" em Conectores com a escolha do provedor, o QR (ou código), o número
  conectado e o botão de desconectar. O bloco da Cloud API continua ali.
- **`enviar_whatsapp`** passa a usar o provedor ativo (`whatsapp/enviar.ts` escolhe). `requires`
  troca `whatsapp: true` por "algum provedor pronto".

**Aceite:** parear lendo o QR na tela; derrubar o GOWA e ver o status mudar e o evento sair; subir
de novo e ver a sessão voltar sem novo QR.

### W2. Receber: webhook, mensagens e mídia

- **Rota `POST /api/whatsapp/webhook/:deviceId`**, sem sessão (como `camera-ingest`), com:
  - corpo cru só nessa rota (a armadilha 5 do workspace: montar o parser cru no caminho exato);
  - HMAC-SHA256 sobre os bytes, `timingSafeEqual`, recusa sem assinatura;
  - `rateLimit` por dispositivo;
  - grava em `wa_evento_bruto` (único por `(deviceId, tipo, externalId)`, `onConflictDoNothing`) e
    responde 200 **antes** de qualquer processamento. O GOWA reenvia se o 200 demora, então nada de
    baixar mídia ou chamar IA aqui dentro;
  - evento desconhecido: log e 200.
- **Job `whatsapp.processar`** (`JobDef` em `jobs/handlers.ts`), com retry. Erro de payload que não
  valida vira `JobPermanentError`.
  1. Traduz (`traduzir.ts`): texto, imagem, áudio, vídeo, documento, figurinha, localização,
     contato. Reação, edição e mensagem apagada atualizam a mensagem existente (apagada guarda o
     texto original, como no workspace).
  2. Normaliza o JID (inclusive LID, conforme W0) e faz upsert em `wa_contato`.
  3. Baixa mídia para `whatsapp.midiaDir` (padrão dentro do diretório de dados da Órbita), com
     dedup por sha256 e teto `whatsapp.midiaMaxMb` (padrão 64).
  4. **Áudio vira texto** na chegada, com `transcribeRecording`. Onde transcreve (nuvem ou local)
     segue `whatsapp.transcricao`: `igual_reunioes` (padrão) · `local` · `nuvem`. O áudio de
     terceiros é dado pessoal de outra pessoa, por isso a escolha é separada.
  5. **Imagem NÃO é descrita na chegada** (custo e privacidade): é descrita quando alguém pergunta
     (W3). A legenda, se houver, entra como texto.
  6. Grava `wa_mensagem` e emite `whatsapp.mensagem_recebida` com `{chatId, contatoId, tipo,
     deMim, grupo}`, **sem o texto** (o texto chega às regras só dentro de `<dado_externo>`).
- **Tabelas** (todas com `userId` cascade, exportadas por `userOwnedTables()`):
  - `wa_contato`: `jid`, `nome` (do WhatsApp), `apelido` (do dono), `pessoaId?` (liga à pessoa da
    casa, se houver), `modo` (`aprovar|automatico`, padrão `aprovar`), `pausadoAte?`.
  - `wa_mensagem`: `chatId`, `contatoId`, `externalId` (único por usuário), `deMim`, `grupo`,
    `tipo`, `texto`, `transcricao?`, `descricaoImagem?`, `midiaCaminho?`, `midiaSha256?`,
    `midiaMime?`, `respondeA?`, `apagada`, `editada`, `enviadaPelaOrbita`, `em`.
  - `wa_evento_bruto`: o envelope, `processadoEm?`, `falhas`, `ultimoErro`. Limpo por retenção.
- **Retenção:** `whatsapp.retencaoDias` (padrão 0 = guardar sempre) apaga mensagem e mídia velhas
  no laço do scheduler. `whatsapp.grupos`: `guardar` · `ignorar` (padrão `guardar`).
  `whatsapp.status` (stories): `ignorar` fixo por padrão, configurável.

**Aceite:** mandar texto, áudio, imagem e documento de outro celular para o número; ver as quatro
mensagens na tabela, o áudio transcrito, a mídia no disco. Reenviar o mesmo webhook não duplica.
Assinatura errada devolve 401.

### W3. Tools de leitura (sem aprovação)

Domínio `whatsapp`, risco `leitura`, todas com teste de `execute` com o banco mockado.

| Tool | Quando usar |
|---|---|
| `whatsapp_conversas_recentes` | "quem me mandou mensagem?", "tem algo no zap?" Lista chats com não lidas e a última mensagem |
| `ler_whatsapp` | "o que a Maria mandou?" Lê as últimas N mensagens de um chat, com transcrição de áudio |
| `buscar_whatsapp` | "quem falou do churrasco?" Busca texto e transcrição (ILIKE na v1; vetor fica para depois) |
| `ver_imagem_whatsapp` | "o que tem na foto que o João mandou?" Descreve a imagem com `narrateSnapshot` e guarda a descrição |

- Achar o contato pelo nome usa `apelido`, `nome` e a pessoa ligada. Nome ambíguo devolve a lista
  e pergunta, nunca escolhe.
- Todo texto de mensagem sai das tools embrulhado como dado externo (§5.2).
- **Tool antiga, regra nova (§9):** `enviar_whatsapp` e as tools novas de envio têm de respeitar
  as MESMAS regras de W4. Teste que prova isso para as quatro.

**Aceite:** pelo chat do app, "o que a Maria me mandou hoje?" responde com texto e o áudio
transcrito; "o que tem na foto?" descreve.

### W4. Responder: texto, áudio e imagem (sempre pelo gate)

Risco `efeito_externo`: o registro enfileira, nunca envia.

| Tool | O que propõe |
|---|---|
| `responder_whatsapp` | texto num chat existente, opcionalmente citando uma mensagem |
| `enviar_audio_whatsapp` | texto que vira nota de voz com a voz da Órbita |
| `enviar_imagem_whatsapp` | uma imagem que a Órbita tem (foto de câmera, arquivo da base, mídia recebida) com legenda |
| `enviar_whatsapp` (existe) | texto para um número, inclusive novo |

- **TTS no core:** extrair a cadeia Edge → Gemini → Piper de `routes/tts.ts` para
  `packages/core/src/voice/sintetizar.ts` (a rota passa a chamar o core, com teste de paridade).
  Converter para OGG/Opus conforme W0: se o GOWA não converter, o `apps/voice` ganha
  `POST /tts?formato=ogg` usando o `ffmpeg` que já tem.
- **Antibanimento** (`whatsapp/antiban.ts`, portado) roda no `run` de TODA tool de envio, com os
  números em config: `whatsapp.envioPorMinuto` (padrão 20), `whatsapp.envioPorDia` (padrão 300,
  número pessoal antigo não precisa de aquecimento). Número que nunca escreveu para o dono é
  permitido **só** quando a aprovação foi humana; no modo automático, é recusado sempre.
- **Evitar eco:** antes de enviar, grava em `wa_mensagem` uma linha `enviadaPelaOrbita` com o
  hash do conteúdo; o webhook `deMim` que casa com ela em até 2 min é reconhecido como nosso. Sem
  isso, a resposta da Órbita na conversa "Eu" volta como mensagem nova do dono e vira laço.
- **`action_queue` ganha** `canal` (`tela|whatsapp|voz`, de onde saiu a proposta), `expiraEm`
  (padrão `whatsapp.aprovacaoValidadeMin` = 30) e o texto final na `summary`, para o dono aprovar
  exatamente o que vai sair.

**Aceite:** "responde a Maria que chego às 8" cria a proposta; aprovar na tela envia; a resposta
aparece no celular da Maria como texto; o mesmo com áudio (nota de voz tocável) e com imagem.

### W5. A conversa "Eu": falar com a Órbita pelo WhatsApp

- Mensagem do dono no próprio chat (`chatId` = `wa_sessao.jid`, `deMim`, não é eco) roda um
  **turno completo** como o do chat do app: persona, RAG, histórico, seleção por relevância com a
  mensagem como query, `requester` = dono via `conta`.
- **Extrair o turno.** `chat.ts` está preso ao HTTP e ao stream; `runPromptForUser` não tem
  histórico nem relevância. Criar `packages/core/src/chat/turno.ts` com a montagem comum (persona,
  RAG, tools, `composeSystem`) e duas saídas: stream (o `chat.ts` passa a usá-la, com
  `orbita-paridade`) e texto (WhatsApp). É o maior risco do PRD; a paridade do chat é obrigatória.
- As mensagens vão para uma conversa da Órbita chamada "WhatsApp", então aparecem no app também.
- **Formato da resposta:** `whatsapp.respostaFormato`: `espelhar` (padrão: áudio responde áudio,
  texto responde texto) · `texto` · `audio`.
- Liga e desliga em `whatsapp.conversaComigo` (padrão ligado).

**Aceite:** mandar áudio "consigo abastecer 100 reais?" na conversa "Eu" e receber a resposta do
motor de finanças em nota de voz, sem aprovação nenhuma. A resposta não dispara outro turno.

### W6. Aprovar sem tela: pelo WhatsApp e por voz

**Regra de segurança central: quem aprova é o código lendo a frase do DONO, nunca o modelo.** Não
existe tool `aprovar_acao`. Se existisse, uma mensagem de terceiro poderia convencer o modelo a
chamá-la, e o gate viraria enfeite.

- **Pelo WhatsApp:** quando uma proposta nasce na conversa "Eu" (`canal: whatsapp`), a Órbita
  responde "Posso responder a Maria: *chego às 8h15*? Diga *manda* ou *cancela*". A PRÓXIMA
  mensagem do dono nessa conversa passa primeiro por `whatsapp/aprovacao.ts` (puro, testado):
  - casa com uma frase de confirmação e há **exatamente uma** proposta pendente e válida desse
    canal → executa por `executeAction`, responde "Enviado.";
  - casa com cancelamento → cancela;
  - mais de uma pendente → lista numerada, e "manda a 2" escolhe;
  - não casa → segue como turno normal, e a proposta continua pendente até expirar.
  - As frases ficam em config (`whatsapp.frasesConfirmar`, `whatsapp.frasesCancelar`), com padrão
    ("manda", "pode mandar", "envia", "sim", "confirmo" / "cancela", "não", "deixa").
  - Áudio do dono é transcrito antes de passar por aqui.
- **Por voz (realtime):** a proposta criada numa sessão de voz é lida em voz alta. A aprovação usa
  a **transcrição da fala do usuário** (evento de transcrição de entrada da sessão realtime, nunca
  o texto que o modelo gerou), casada pelo mesmo `aprovacao.ts` no navegador, que chama
  `POST /api/actions` com o id. É o mesmo pedido que o botão faz, com a sessão do dono. O prompt de
  voz passa a dizer "diga manda para eu enviar" em vez de "aprove no painel".
- **Validade:** proposta vencida não se aprova por frase (só pela tela), para um "manda" solto
  horas depois não disparar nada.

**Aceite:** pedir pela conversa "Eu" para responder a Maria, dizer "manda" (texto e áudio) e ver
sair; com duas pendentes, a lista aparece; uma mensagem de TERCEIRO dizendo "manda" não aprova
nada (teste automatizado).

### W7. Responder sozinha, contato a contato

- Na tela, cada contato tem o interruptor "A Órbita responde sozinha" (`wa_contato.modo`), com o
  aviso do que isso significa. Grupo e número desconhecido não têm o interruptor.
- **Turno restrito** (`whatsapp/automatico.ts`), montado com `toToolSet` sobre uma lista explícita:
  - tools: `ler_whatsapp` e `responder_whatsapp` **presas ao chat de origem** pelo contexto (o
    parâmetro de chat nem existe no schema desse turno);
  - sem RAG, sem memória, sem persona de dados pessoais, sem MCP, sem skills: a Órbita não sabe
    finanças, agenda, câmera, casa nem identidade nesse turno. Não há o que vazar;
  - o `enqueue` desse turno executa direto, porque o único efeito possível é responder a quem
    escreveu, no chat dele;
  - instrução de sistema própria (`whatsapp.promptAutomatico`, editável), com a regra de dizer
    "vou avisar o Wesley" para o que não souber.
- **Travas:**
  - teto por contato (`whatsapp.automaticoPorHora`, padrão 10) e pausa ao estourar, avisando o dono;
  - **o dono assume:** se o dono escreve manualmente nesse chat, o automático pausa por
    `whatsapp.pausaAoAssumirMin` (padrão 60);
  - anti-laço entre robôs: 5 respostas automáticas seguidas sem mensagem humana do outro lado
    pausam o contato;
  - tudo que saiu sozinho fica em `wa_mensagem.enviadaPelaOrbita` e aparece numa lista na tela.
- **Exceção ao §5.1** registrada no CLAUDE.md: vale só para este turno, só para contato marcado,
  só para responder no chat de origem.

**Aceite:** marcar um contato, mandar mensagem dele, ver a resposta sair sozinha; do mesmo
contato, pedir "qual o saldo do Wesley?" e a resposta não conter nenhum dado (teste com o LLM
mockado provando que as tools de finanças nem estão no ToolSet); escrever manualmente e ver a
pausa.

### W8. Documentação

- CLAUDE.md: §5.1 com a exceção de W7; §8 com a tabela de onde fica cada peça; §9 com as
  armadilhas de W0 e as desta lista.
- `docs/whatsapp-gowa.md` (de W0) e o `.env.example` com `GOWA_BASIC_AUTH`.
- `CHECKLIST.md`: I1 deixa de dizer que WhatsApp depende do Embedded Signup.

---

## 6. Ordem de execução

| Ordem | Item | Depende de | Observação |
|---|---|---|---|
| 1 | W0 sondagem | número de teste | bloqueia o resto; resposta 1 decide onde o GOWA roda |
| 2 | W1 infra e pareamento | W0 | |
| 3 | W2 receber | W1 | |
| 4 | W3 leitura | W2 | aqui a Órbita já é útil |
| 5 | W4 responder | W3 | extração do TTS pode correr em paralelo desde o início |
| 6 | W5 conversa "Eu" | W4 | extração do turno com paridade |
| 7 | W6 aprovar sem tela | W5 | |
| 8 | W7 automático | W6 | |
| 9 | W8 docs | todos | |

---

## 7. Armadilhas (já pagas no `whatsapp-workspace`, não repetir)

1. Toda rota do GOWA exige `X-Device-Id`, inclusive `/statics`; sem ele, 400.
2. O caminho de mídia do payload muitas vezes não é servido; manter o `/message/{id}/download`.
3. O nome do campo multipart muda por rota (`image`, `audio`, `file`…), e o `Content-Type` não se
   põe à mão (o `fetch` precisa pôr o boundary).
4. O link do QR é interno e tem auth: proxiar e devolver data URL.
5. O parser de corpo cru vai no caminho exato do webhook, não num prefixo.
6. "Não pareado" chega de três jeitos (`INVALID_WA_CLI` 500, `AUTHENTICATION_ERROR` 401, e só no
   texto da mensagem).
7. As respostas misturam `PascalCase` (whatsmeow) e `snake_case`: ler os dois.
8. Não há API de bloqueio (404); bloquear é só local.
9. O GOWA reenvia o webhook se o 200 demora.
10. Mensagem apagada guarda o texto original.

E as da Órbita:

11. **Eco na conversa "Eu"** (W4): sem o reconhecimento por hash, a Órbita conversa com ela mesma.
12. **Aprovação nunca é tool** (W6).
13. **Tool antiga, regra nova:** antibanimento e validade valem para `enviar_whatsapp` também.
14. **Multi-conta (§9):** uma sessão por dono na v1, mas toda consulta já filtra por `deviceId`,
    para uma segunda conta não virar reescrita.

---

## 8. Riscos

| Risco | Tamanho | Mitigação |
|---|---|---|
| Banimento do número pessoal | real, baixo no uso de resposta | antibanimento portado, sem abordagem fria automática, sessão estável (whatsmeow), reconexão contada |
| Prompt-injection por mensagem de terceiro | alto se mal feito | turno restrito sem dados (W7), aprovação fora do modelo (W6), texto sempre como dado externo |
| Sessão do GOWA roubada | alto (conta inteira) | só em `127.0.0.1`, Basic auth gerada, volume fora do git, URL só local |
| Mudança do protocolo do WhatsApp quebra o GOWA | médio | tag fixada, saúde com evento `sessao_caiu`, atualização deliberada |
| Regressão do chat ao extrair o turno (W5) | médio | `orbita-paridade` antes e depois |
| Dado pessoal de terceiros | médio | retenção configurável, transcrição local opcional, cascade no apagar da conta |

---

## 9. Aceite da fase

1. Os aceites de W0 a W7 passam no app real, com um número pareado.
2. `tsc --noEmit` limpo em `apps/web` e `apps/api`, `vitest run` verde, testes portados do
   workspace passando, e um teste de `execute` por tool nova.
3. `account/data.test.ts` pega as tabelas `wa_*` sozinho.
4. Teste automatizado: mensagem de terceiro não aprova proposta, não alcança tool de finanças no
   modo automático e não dispara turno quando o contato está em `aprovar`.
5. Smoke manual de voz (§7.5 do CLAUDE.md): pedir e aprovar por voz.

---

## 10. Estado da implementação (2026-09-27)

W1 a W8 implementados. Typecheck limpo nos dois apps; testes novos em `whatsapp/*.test.ts`,
`actions/*.test.ts`, `tools/domains/whatsapp-tools.test.ts` e `voice/sintetizar.test.ts`.

### Verificado no app real, contra o GOWA v9.5.0 de verdade

- Pareamento por QR pela rota da Órbita, duas vezes seguidas (idempotente), QR em data URL.
- O contêiner alcança o `apps/api` em `host.docker.internal:3010` com o Nest preso no 127.0.0.1
  (W0 item 1: **sim**, no Docker Desktop).
- Webhook assinado passando por Nest → ponte → rota: assinatura certa 200, errada 401,
  dispositivo desconhecido 401, reentrega sem duplicar.
- Mensagem de terceiro guardada como dado; conversa "Eu" reconhecida; turno do dono respondido
  pelo modelo da assinatura em ~4 s, com histórico na conversa "WhatsApp" do app.
- Pedido "responde a Maria…" na conversa "Eu" → o modelo propôs `responder_whatsapp` sozinho →
  proposta com `canal: whatsapp`, validade de 30 min e o texto inteiro no resumo → "Manda!"
  aprovou pelo código → o envio chegou ao GOWA (que recusou por não haver celular pareado, com a
  mensagem certa).
- `POST /converter/ogg` do `apps/voice`: WAV vira OGG/Opus válido (400 para vazio, 422 para lixo).

### Desvios do PRD, e por quê

| Item | PRD dizia | Ficou | Por quê |
|---|---|---|---|
| W2 | processar pela fila `jobs/` | tabela `wa_evento_bruto` como fila, em série no processo, laço `whatsapp-pendentes` | uma linha de trabalho por mensagem enterraria os trabalhos do dono na tela |
| W5 | extrair o turno de `routes/chat.ts` | turno próprio em `whatsapp/turno.ts` com as MESMAS peças, sem stream | mexer no caminho crítico do chat por um canal novo não compensava o risco |
| W7 | tools `ler`/`responder` presas ao chat | turno SEM NENHUMA tool; quem envia é o código | superfície zero é mais forte que superfície presa |
| W4 | `enviar_imagem` de câmera ou arquivo | imagem guardada no WhatsApp (recebida ou mandada na conversa "Eu") | é o caso real ("manda essa foto pra Maria"); câmera fica para quando houver pedido |
| W1 | porta 3001 | 127.0.0.1:3011 | a 3001 desta máquina é do GOWA do `whatsapp-workspace` |

### Ainda depende de um celular pareado (sondagem W0 restante)

1. Formato real da conversa "Eu" (`chat_id` igual ao JID do dono? chega como LID?). Se chegar
   como `@lid`, `rotear` não reconhece e a conversa "Eu" fica muda: ajustar `normalizarJid`.
2. A nota de voz OGG/Opus toca como nota de voz (com forma de onda) no celular.
3. Download de mídia recebida: caminho local do payload e `/message/{id}/download`.
4. O eco de áudio e de imagem casa pelo hash (`audio:` vazio e `imagem:<legenda>`).

Para rodar: `docker compose up -d gowa`, gerar `GOWA_BASIC_AUTH` no `.env`, reiniciar o `apps/api`
e o `apps/voice` (o endpoint de conversão é novo), e parear em Conectores → WhatsApp pessoal.
