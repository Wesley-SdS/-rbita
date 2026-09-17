# PRD — FASE 2: IDENTIDADE E PERCEPÇÃO

> A Órbita passa a saber **quem é quem** (pela voz e pelo rosto), **o que está acontecendo** na casa,
> e usa isso para ajudar em tarefas que precisam de visão.
>
> Versão 2, de 2026-09-17, reescrita **depois** que a Fase 1 (Ondas 1 a 6) foi concluída e commitada
> (`82cbee2`, `6caadc1`, `b4e8401`). Tudo em "Estado de partida" foi verificado no código.
> Decisões do dono estão marcadas como **DECIDIDO**; o resto é recomendação.

---

## 1. Por que esta fase existe

A Fase 1 entregou reuniões com separação de vozes, câmeras com eventos, casa pelo Home Assistant e
voz em tempo real com tools. Mas a Órbita ainda não sabe **quem**:

- A transcrição diz "Locutor A". O nome real só existe se o dono renomear **reunião por reunião**.
- A câmera diz `label: "person"`. O dono quer "**Anna** está na sala, cozinhando".
- As permissões por pessoa e cômodo existem no banco, mas **nenhuma tool as aplica**, porque não
  há como saber quem está pedindo.

Identidade é o que transforma percepção em ajuda de verdade, e permissão cadastrada em permissão
aplicada.

---

## 2. Decisões do dono

| Tema | Decisão |
|---|---|
| Nome nos locutores | **DECIDIDO:** o locutor é a pessoa, reconhecido pela voz entre reuniões |
| Assinatura de voz | **DECIDIDO:** guardar assinatura de voz das pessoas |
| Reconhecimento facial | **DECIDIDO:** identificar pela câmera quem é o Wesley e quem é a Anna |
| Atividade | **DECIDIDO:** entender o que as pessoas estão fazendo |
| Ajuda com visão | **DECIDIDO:** ajudar em tarefas que precisam enxergar |

Os três princípios continuam valendo sem exceção: **assistente pessoal, não SaaS** · **zero
hardcode** · **tools crescem, nunca somem**.

---

## 3. Estado de partida (verificado no código em 2026-09-17)

| Peça | Onde | O que já existe | O que falta para esta fase |
|---|---|---|---|
| Pessoas | `packages/db/src/home-schema.ts` → `person` | `id`, `userId` (dono), `name`, `role` (dono/morador/visitante) | apelidos, consentimento, tipo de relação, amostras biométricas |
| Permissão por cômodo | `person_room_access` + `packages/core/src/home/permission.ts` | regra pronta e testada | **ninguém chama**: falta saber quem pede |
| Nome de locutor | `document.speakers` (jsonb) | renomear "Locutor A" por reunião, só na exibição | reconhecer a mesma voz em outra reunião |
| Câmeras | `camera`, `camera_event` | ingestão por webhook com token por câmera; `label`, `zone`, `score`, `snapshot` (data URL), `narration` sob demanda | **nenhum campo de pessoa**; sem detecção de rosto |
| Narração | `packages/core/src/cameras/narrate.ts` | VLM em um keyframe, sob demanda | ⚠️ usa `resolveVisionModel()`: com `OPENAI_API_KEY` o snapshot **vai para a nuvem** |
| Gestos | — | nada (CAM.4 ficou aberto) | tudo |
| Identidade de dispositivo | — | nada (B5.3/B5.4 abertos) | tudo |
| Event bus | `apps/api/src/events` + outbox `event_log` | eventos `camera.detected`, `home.*`, `memory.*`, `mcp.*` | eventos de identidade |
| Regras proativas | `automation_rule` | gatilho → condição → ação | condições sobre pessoa |
| Registro de tools | `packages/core/src/tools/domains/*` | risco declarado, gate derivado, `tool_config`, seleção por relevância | domínio `identidade` |
| Config | tabela `setting`, `packages/core/src/settings/defs.ts`, tela "Ajustes" | chave nova aparece sozinha na tela | limiares e retenções biométricas |

### Duas limitações reais do caminho de voz atual

1. **O servidor nunca recebe o áudio dos comandos de voz.** O ditado e o wake word usam a Web Speech
   API do navegador: sai texto, não áudio. O modo realtime vai por WebRTC **direto para a OpenAI**.
   Para saber *quem* pediu pela voz, é preciso gravar um trecho curto em paralelo e mandar para o
   serviço local de percepção.
2. **Inferência local satura a CPU desta máquina.** Um `qwen2.5:7b` no Ollama leva de 37 s a minutos
   e deixa o resto do sistema lento (memória `orbita-cpu-local-llm-trava-vm`). Um serviço de
   biometria rodando junto vai competir pela mesma CPU. **Medir antes de prometer tempo real.**

---

## 4. Inegociáveis de privacidade

Assinatura de voz e de rosto são **dados biométricos**. Estas regras não são configuráveis: são a
condição para a funcionalidade existir.

1. **Assinatura biométrica nunca sai de casa.** Embeddings de voz e de rosto, amostras de cadastro e
   recortes de rosto só existem na máquina local. Nenhum provedor de nuvem os recebe.
2. **Snapshot com identificação ligada não vai para VLM de nuvem.** Hoje a narração manda o snapshot
   para a OpenAI quando há chave. Com identidade ligada naquela câmera, a narração usa **só modelo
   local**, a menos que o dono libere a nuvem **por câmera**, e ainda assim com rostos borrados.
   O nome é aplicado depois, localmente.
3. **Transcrição na nuvem continua sendo escolha do dono.** A AssemblyAI já recebe o áudio da reunião
   para transcrever e separar vozes; isso não muda. O que muda: o **reconhecimento** de quem é cada
   locutor acontece localmente.
4. **Consentimento por pessoa**, registrado (quem, quando, o quê). A Anna aceita por ela. Menor de
   idade exige o responsável.
5. **Apagar é apagar.** Remover uma pessoa elimina amostras, embeddings, recortes e referências em
   `camera_event` e `event_log`, sem resíduo.
6. **Visitante não vira cadastro sozinho.** Voz ou rosto desconhecidos geram identidade efêmera com
   retenção curta.
7. **Toda identificação é auditada** e perguntar sobre outra pessoa **exige permissão**.
8. **Voz reconhecida sozinha nunca libera ação perigosa.** Voz pode ser gravada ou imitada.
9. **Teste automatizado de não-vazamento:** falha se qualquer payload para provedor de nuvem contiver
   embedding biométrico, amostra de cadastro ou recorte de rosto de pessoa identificada.

---

## 5. O que a fase entrega

### 5.1 Pessoas da casa, de verdade

`person` ganha: apelidos, relação (morador, visitante frequente, contato externo), consentimento
registrado, e a tela de cadastro com o termo de consentimento. Apagar a pessoa apaga tudo dela.

### 5.2 Assinatura de voz

**Cadastro**, por qualquer caminho:
- gravar ~30 a 60 segundos na tela de cadastro
- **a partir de reunião já gravada**: o `document.speakers` que já existe vira porta de entrada —
  ao renomear "Locutor A" para "Wesley", a Órbita pergunta se aquelas falas podem virar amostra
- no dia a dia, depois de confirmar quem está falando

**Uso:**
- **Reuniões:** cada fala diarizada é comparada com as assinaturas e já chega com nome.
  Sem correspondência, vira "Desconhecido 1", nomeável com um toque.
- **Comandos de voz:** a Órbita sabe **quem** pediu (ver a limitação 1 da §3). Isso liga, enfim, a
  regra de `permission.ts` e personaliza pedidos como "minha agenda".
- **Correção ensina:** nome corrigido vira amostra nova.

### 5.3 Rosto e presença

- Cadastro por fotos na tela ou alguns segundos na frente de uma câmera, com confirmação.
- Evento de câmera com pessoa ganha identidade: `camera_event` passa a referenciar `person`
  (ou uma identidade efêmera de desconhecido).
- **Presença por cômodo:** quem está onde, agora. Alimenta permissões, cenas ("apaga a luz de onde
  **eu** estou") e a voz no cômodo certo.

### 5.4 Atividade e ajuda com visão

| Pedido | O que a Órbita faz |
|---|---|
| "Onde deixei a chave?" | Busca na memória visual recente (objetos com cômodo e horário) |
| "A Anna já saiu?" | Consulta presença, respeitando permissão |
| "Como está o forno?" | Olha a câmera da cozinha e responde |
| "Me ajuda com essa receita" | Acompanha a bancada e orienta o próximo passo |
| "Lê esse documento" | Lê o papel mostrado para a câmera |
| "O que aconteceu enquanto eu estava fora?" | Resumo do dia **com nomes** |
| "Quem disse que entregava na sexta?" | Busca por fala **com nome** entre reuniões |

**Gestos** (o CAM.4 que ficou aberto) entram aqui, por pessoa: o mesmo gesto pode fazer coisas
diferentes para cada um.

---

## 6. Arquitetura

```
  Câmeras ──webhook (já existe)──┐        Reuniões (AssemblyAI)   Comandos de voz
  Frigate / script               │                │               (trecho gravado em paralelo)
                                 ▼                ▼                        ▼
                      ┌──────────────────────────────────────────────────────┐
                      │  apps/perception  (Python, NOVO, sem saída p/ internet)│
                      │  voz: embedding de locutor · rosto: detecção+embedding │
                      │  pose: keypoints e gestos                              │
                      │  STATELESS: calcula vetores, não guarda identidade     │
                      └───────────────────────────┬──────────────────────────┘
                                                  │ vetores + confiança
                                                  ▼
                      ┌──────────────────────────────────────────────────────┐
                      │  apps/api (Nest, já existe)                          │
                      │  person + voiceprint + face_embedding (pgvector)     │
                      │  casamento por cosseno, limiar em `setting`          │
                      │  presença · auditoria · eventos identity.*           │
                      │  domínio de tools `identidade` · permission.ts ligado │
                      └──────────────────────────────────────────────────────┘
```

- **Percepção stateless:** quem é quem é regra de negócio com permissão e auditoria, e mora no
  `apps/api`. O Python só transforma áudio e imagem em vetores. Trocar de modelo não mexe em
  identidade; apagar uma pessoa é um lugar só.
- **pgvector, não um banco novo:** já usado com HNSW e cosseno no RAG e no índice de entidades da
  casa. Assinatura biométrica é o mesmo problema de vizinho mais próximo com limiar.
- **Trocar de modelo invalida vetores.** Guardar as **amostras brutas** de cadastro, cifradas e
  locais, para recalcular em lote.
- **Serviço separado do `apps/voice`**, com venv e versões próprias: dependências de visão são
  pesadas e não podem quebrar o STT/TTS que já funciona.
- **Câmeras continuam por webhook.** A ingestão genérica da Fase 1 (`POST /api/cameras/ingest`)
  segue sendo a porta; a identificação acontece depois de um evento com pessoa, sobre o snapshot.

---

## 7. Tecnologia recomendada (validar com medição nesta máquina, que não tem GPU)

| Função | Recomendação | Alternativa | Por quê |
|---|---|---|---|
| Embedding de voz | ECAPA / WeSpeaker via **sherpa-onnx** | SpeechBrain (PyTorch) | ONNX leve em CPU |
| Rosto | **InsightFace** (ArcFace) via onnxruntime | OpenCV YuNet + SFace | InsightFace é o padrão de precisão; OpenCV é bem mais leve |
| Pose e gestos | **MediaPipe** | — | Ferramenta certa para gesto; checar suporte à versão do Python |
| Câmeras | webhook atual, com Frigate como NVR | — | Avaliar o reconhecimento facial do próprio Frigate antes de duplicar |
| Atividade | VLM **local** (moondream, qwen2.5-vl) | nuvem por câmera, sem rostos | Regra 2 de privacidade |
| Extração estruturada | `generateStructured` (já existe) | — | `generateObject` do AI SDK falha com Ollama |

### Limites a mostrar na UI, sem esconder

- Fala curta (menos de ~2 a 3 s) identifica mal. Toda identificação sai **com confiança**.
- Áudio de reunião comprimido e pessoas parecidas (parentes) derrubam a precisão.
- Rosto de lado, contraluz e baixa resolução idem.
- Abaixo do limiar é "provavelmente X" ou "desconhecido", nunca afirmação.
- Limiares e retenções são **chaves em `setting`**, com tela.

---

## 8. Tools novas (domínio `identidade`)

| Tool | O que faz | Risco |
|---|---|---|
| `quem_esta_em_casa` | Pessoas presentes e onde | leitura · exige permissão sobre pessoas |
| `onde_esta` | Cômodo atual de uma pessoa | leitura · exige permissão |
| `o_que_esta_acontecendo` | Descrição de um cômodo agora | leitura |
| `ver_camera` | Olha uma câmera e responde a uma pergunta | leitura |
| `procurar_objeto` | "Onde deixei X" na memória visual | leitura |
| `resumo_do_dia_cameras` | O que aconteceu num período, com nomes | leitura |
| `quem_disse` | Busca fala com nome entre reuniões | leitura |
| `nomear_locutor` | Associa locutor diarizado a uma pessoa | escrita |
| `cadastrar_pessoa` | Inicia cadastro com consentimento | **perigoso** |
| `apagar_biometria` | Remove amostras e vetores de alguém | **perigoso** |

---

## 9. Decisões pendentes (abrir em formulário, com recomendação)

1. **Contatos externos.** Guardar voz de quem não mora na casa? *Recomendado:* não por padrão; casar
   com convidados da agenda por eliminação; cadastro manual caso a caso com consentimento.
2. **Retenção de desconhecido.** *Recomendado:* 7 dias, configurável.
3. **Presença contínua ou sob demanda.** *Recomendado:* presença contínua (barata, sem VLM);
   descrição de atividade sob demanda, mantendo a decisão da Fase 1.
4. **Memória visual de objetos.** *Recomendado:* lista de objetos editável pela UI, retenção de 48 h.
5. **Voz para ação perigosa.** *Recomendado:* voz reconhecida **mais** confirmação.
6. **VLM de nuvem com identidade ligada.** *Recomendado:* desligado; liberável por câmera, com rostos
   borrados.
7. **Onde roda a percepção.** Nesta máquina sem GPU, ou esperar o servidor da casa? *Recomendado:*
   medir aqui primeiro; se voz e rosto não couberem junto com o Ollama, a medição vira a
   especificação do hardware.

---

## 10. Ondas da Fase 2

```
ONDA 7   Dívida da Fase 1 que bloqueia identidade
         RV.1 guard de dono nas configs globais · RV.6 event_log no apagar/exportar ·
         RV.8 testes que faltam · camada 3 da paridade com o dono · RV.2 a RV.5 e RV.7

ONDA 8   Pessoas e consentimento
         person completo, termo de consentimento, apagar biometria em cascata,
         auditoria de identificação, permissão sobre pessoas

ONDA 9   Assinatura de voz
         apps/perception (voz) · cadastro por gravação e por reunião · nomes entre reuniões ·
         trecho de áudio em paralelo ao ditado · "quem pediu" · permission.ts ligado às tools

ONDA 10  Rosto e presença
         apps/perception (rosto) · camera_event → person · presença por cômodo ·
         desconhecido efêmero · regra 2 de privacidade na narração

ONDA 11  Atividade, ajuda com visão e gestos
         tools do domínio identidade · memória visual de objetos · CAM.4 gestos por pessoa

ONDA 12  Identidade em tudo
         B5.3/B5.4 dispositivo e cômodo · voz segue a pessoa · resumo do dia com nomes ·
         regras proativas com condição sobre pessoa
```

Cada onda fecha com: typecheck e testes verdes (Node e Python), `/orbita-review` sem achado que
reprova, teste de não-vazamento verde, checklist publicado atualizado, e **teste com a biometria real
do dono** — dado sintético não prova precisão.

### Fora desta fase (continuam abertos da Fase 1, para uma Fase 3)

Roteador de dois eixos (B2.2) · caminho rápido doméstico (B10.1) · pool de MCP (B10.2) · extração
automática de memória (B4.1) · sumarização de conversa (B4.2) · OCR do Adalink · infra 24/7 com URL
pública (B9.1, que destrava push do Google e B6.3) · observabilidade (B8.1) · VAD silero (B5.2) ·
STT em streaming (B5.1) · satélites (B5.5) · saída de áudio por cômodo (B5.10).

---

## 11. Riscos

| Risco | Mitigação |
|---|---|
| CPU saturada com Ollama e biometria juntos | Medir na Onda 9; identificar só em evento de pessoa, nunca por quadro; decisão 9.7 |
| Precisão ruim em áudio de reunião | Confiança sempre visível; correção vira amostra; medir com reuniões reais |
| Voz gravada ou imitada | Nunca voz sozinha para ação perigosa |
| Snapshot com rosto indo para nuvem | Regra 2 + teste de não-vazamento |
| Qualquer conta logada alterar limiares biométricos | RV.1 na Onda 7, antes de tudo |
| Troca de modelo invalidar assinaturas | Amostras brutas cifradas e reprocessamento em lote |
| Dependências Python quebrarem a voz atual | Serviço e venv separados do `apps/voice` |

## 12. Fora de escopo

Emoção ou estado de saúde · identificar pessoas em conteúdo externo · uso comercial ou compartilhamento
de biometria · leitura labial.
