# PROMPT — FASE 2: IDENTIDADE E PERCEPÇÃO

> A Fase 1 (Ondas 1 a 6) está concluída e commitada. Cole o bloco abaixo numa sessão nova, na raiz
> do projeto.

---

```
Você vai implementar a Fase 2 da Órbita: identidade e percepção. A Órbita passa a
saber QUEM é quem pela voz e pelo rosto, O QUE está acontecendo na casa, e usa
isso para me ajudar em tarefas que precisam de visão.

## ANTES DE QUALQUER COISA

1. Leia, nesta ordem:
     CLAUDE.md                            (convenções atuais, já com apps/api)
     PRD-FASE2-IDENTIDADE-PERCEPCAO.md    (o documento desta fase)
     BRIEFING-JARVIS.md                   (contexto da Fase 1)
2. Use as skills de .claude/skills/ (orbita-dev, orbita-review, orbita-paridade,
   adalink-referencia).
3. Suba tudo com /orbita-dev e confirme /api/health verde.
4. O PRD §3 descreve o estado de partida verificado em 17/09. Confira o que for
   crítico no código antes de agir; se divergir, o código manda, e me avise.


## OS PRINCÍPIOS (continuam valendo)

1. ASSISTENTE PESSOAL, NÃO SAAS. "Pessoas da casa" não é multi-tenant.
2. ZERO HARDCODE. Limiares de reconhecimento, retenções, objetos da memória
   visual, câmeras com identificação ligada: chaves em `setting` ou tabelas,
   sempre com tela.
3. TOOLS CRESCEM, NUNCA SOMEM. As tools novas entram como domínio `identidade`
   no registro, com risco declarado.


## PRIVACIDADE — INEGOCIÁVEL (PRD §4)

- Assinatura biométrica (embedding de voz ou rosto, amostra de cadastro,
  recorte de rosto) nunca sai de casa.
- Com identificação ligada numa câmera, a narração usa SÓ modelo local. Hoje
  `packages/core/src/cameras/narrate.ts` usa `resolveVisionModel()`, que manda
  o snapshot para a OpenAI quando há chave. Isso precisa mudar na Onda 10.
- Consentimento registrado antes de qualquer cadastro. Apagar é apagar tudo,
  inclusive referências em `camera_event` e `event_log`.
- Toda identificação é auditada. Perguntar sobre outra pessoa exige permissão.
- Voz reconhecida SOZINHA nunca libera ação perigosa.
- Escreva o TESTE DE NÃO-VAZAMENTO: falha se algum payload para provedor de
  nuvem contiver dado biométrico. Ele roda em toda onda.


## DUAS LIMITAÇÕES QUE VOCÊ PRECISA RESPEITAR (PRD §3)

- O servidor nunca recebe o áudio dos comandos de voz: o ditado usa Web Speech
  no navegador (sai texto) e o realtime vai por WebRTC direto à OpenAI. Para
  saber quem pediu, grave um trecho curto em paralelo e mande ao serviço local.
- Inferência local satura a CPU desta máquina (sem GPU). Ao testar rota
  autenticada com LLM local, bata direto no apps/api (:3010) forjando o Host,
  como na memória `orbita-cpu-local-llm-trava-vm`. Para extração estruturada
  com modelo local, use `generateStructured`, nunca `generateObject`.


## COMO TRABALHAR COMIGO

- Decisão que muda o resultado → FORM (AskUserQuestion). Sua recomendação é a
  PRIMEIRA opção, com "(Recomendado)" e o trade-off na descrição.
- Agrupe perguntas relacionadas (até 4 por form).
- Pergunte no momento em que a decisão é necessária. As 7 decisões pendentes
  estão no PRD §9, com recomendação: abra cada uma quando a onda dela começar.
- Não pergunte o que dá para decidir com bom senso, com o CLAUDE.md ou lendo o
  código. Decida, faça, e me diga o que assumiu.
- Para subagentes, siga a alocação da memória `orbita-alocacao-modelos-agentes`:
  Sonnet para volume, Opus para núcleo técnico, Fable só para segurança e
  decisão de arquitetura entre ondas.


## MEÇA ANTES DE ESCOLHER

O PRD §7 recomenda sherpa-onnx (voz), InsightFace (rosto), MediaPipe (pose).
Antes de fixar, NESTA máquina:
- latência por amostra em CPU, e com o Ollama rodando ao mesmo tempo
- precisão com a MINHA voz e o MEU rosto, não com dado sintético
- compatibilidade com a versão do Python (venv próprio em apps/perception,
  separado do apps/voice)
- se o Frigate já faz reconhecimento facial
Me mostre os números e peça a decisão num form.


## ORDEM

  ONDA 7   Dívida da Fase 1 que bloqueia identidade (RV.1 guard de dono PRIMEIRO)
  ONDA 8   Pessoas e consentimento
  ONDA 9   Assinatura de voz
  ONDA 10  Rosto e presença
  ONDA 11  Atividade, ajuda com visão e gestos (inclui o CAM.4)
  ONDA 12  Identidade em tudo (inclui B5.3 e B5.4)

Detalhe em PRD §10. Os itens transversais da Fase 1 listados no PRD como "fora
desta fase" NÃO entram aqui.


## FECHAMENTO DE CADA ONDA

  1. tsc limpo no web e no api, vitest verde, testes Python verdes
  2. Código novo com teste, incluindo o teste de não-vazamento
  3. /orbita-review sem achado que reprova
  4. Teste com a MINHA biometria real a partir da Onda 9 — me diga
     exatamente o que precisa de mim (gravar voz, ficar na frente da câmera)
  5. Nenhum limiar, lista ou retenção hardcoded
  6. Checklist publicado atualizado:
       https://claude.ai/artifact/K4pZh4kukZfJWdxXcYDeD6
     Artifact action:"read" com essa url → crie a seção "FASE 2" com as ondas
     7 a 12 se não existir → marque os itens → republique com a MESMA url
  7. Commit da onda, e o resumo do que mudou e do que NÃO deu para verificar

Ao terminar cada onda, PARE e me dê o resumo. Não emende ondas sem eu confirmar.


## COMECE ASSIM

1. /orbita-dev e /api/health verde.
2. Leia o PRD e confira o §3 contra o código.
3. Crie a seção FASE 2 no checklist publicado, com os itens das 6 ondas.
4. Abra o primeiro form (o que trava a Onda 7) e execute a Onda 7.
```
