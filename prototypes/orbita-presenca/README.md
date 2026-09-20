# Órbita Presença

Proposta 01 de redesign. Front independente para avaliar identidade, animação,
arquitetura da informação e interações. O aplicativo atual não foi substituído.

## Abrir

**Versão portátil:** abra `orbita-presenca.html`. É um HTML único, com estilos,
ícones e animações incluídos, que pode ser compartilhado sozinho.

**Fontes editáveis:** abra `index.html`, mantendo `styles.css`, `orb.js`,
`orb-3d.js`, `research.js` e `app.js`
na mesma pasta. Não precisa de instalação, Docker, banco ou IA.

Ou, na raiz do repositório:

```powershell
node prototypes/orbita-presenca/serve.mjs
```

Endereço: **http://127.0.0.1:4173**. Para encerrar, `Ctrl+C` nesse terminal.

Após editar os fontes, regenere o HTML portátil com:

```powershell
node prototypes/orbita-presenca/bundle.mjs
```

## Percurso sugerido

1. Comece pela visão geral e abra **Explorar o novo design**, no menu lateral.
2. Experimente os **dez estados** ou **Percorrer uma conversa**. Mova o cursor
   sobre a esfera para mudar a perspectiva; clique ou use Enter para energizá-la.
3. Teste o tema escuro no ícone da lua e o movimento reduzido no laboratório.
4. Clique em **Prefiro escrever**. Envie “como está meu dia?” ou
   “vamos retomar minha ideia para a Órbita”. Interrompa uma resposta para ver
   o estado de cancelamento.
5. Explore Memória (buscar, filtrar, criar, editar, esquecer, mapa), Rotinas
   (criar, pausar, testar), Casa (luzes, intensidade, cenas e aprovações),
   Reuniões (transcrição simulada e resumo), Finanças (registrar um gasto)
   e Conexões (examinar permissões e simular conexão).
6. Abra o sino para revisar e aprovar ou recusar uma ação demonstrativa.
7. Experimente o modo foco: temporizador real de 25 minutos, pausa e retomada.
8. Use `Ctrl+K` (ou `⌘K`) para navegar e encontrar memórias. `Esc` fecha
   sobreposições, interrompe demonstrações e para a leitura do navegador.
9. Clique em **Pesquisar com fontes**: os cards surgem progressivamente com
   domínio, resumo e link original. No chat, envie “pesquise interfaces 3D”.
   O tema de exemplo é fixo; não existe busca web conectada neste front.
10. Redimensione a janela para conferir o menu e os cartões no celular.

## Direção criativa

Interface mineral com um núcleo de inteligência expressivo, inspirado na
presença operacional do Jarvis: mineral `#F6F7F2`, floresta `#214E3E`,
menta `#C9F4B0`, névoa `#ECE7F4` e argila `#F6E8DA`.
Tipografia de sistema, ícones próprios e geometria tridimensional em WebGL nativo.
Esfera ampliada com membrana translúcida, reflexos suaves e interior perolado.
Veios curvos se ramificam em dois volumes, com conexões entre eles e pontos de
ativação. Impulsos percorrem os caminhos; as órbitas são fios ópticos finos.
A inspiração em sinapses é artística, não uma representação científica do cérebro.
O gesto do cursor orienta a presença; clique e Enter produzem uma reação expansiva.
Sem fontes remotas, imagens externas, CDN ou bibliotecas. Canvas 2D como fallback.
Os reflexos são uma aproximação procedural, não ray tracing nem uma imagem pré-renderizada.

### Movimento como linguagem

| Estado | Comportamento |
| --- | --- |
| Presença | Respiração, flutuação, impulsos espaçados e atenção ao cursor |
| Escutando | Alongamento delicado e ondas que convergem para dentro |
| Pensando | Ativação de grupos de veios e ondulações localizadas |
| Falando | Expansões irregulares, sinais sincronizados e ondas para fora |
| Pesquisando | Lâmina de luz, ativação interna e descoberta progressiva de fontes |
| Conectando | Sinais entre regiões e arcos leves de aproximação |
| Executando | Impulsos mais rápidos e sequências coordenadas de ativação |
| Concluído | Expansão, pequena elevação e liberação de uma onda luminosa |
| Sua decisão | Volume recolhido, pulsação lenta e contorno âmbar |
| Imprevisto | Retração breve, tom quente e desaceleração sem flashes |

O desenho pausa quando sai da tela ou a aba fica oculta, limita a densidade de
pixels a 1,4 no WebGL (1,6 no fallback) e visa 24/30 quadros por segundo. `prefers-reduced-motion` e o
controle do laboratório eliminam o movimento contínuo, preservando cor e texto.

## O que é real e o que é demonstrativo

**Funciona no front:** navegação, animações, temas, filtros, busca, edição de
memórias, formulários, cancelamento da resposta, controles da casa, simulação de
fluxos, temporizador, diálogos, exportação JSON e estados de aprovação.
Os cards de fontes têm links reais para MDN, Three.js e Khronos; descoberta,
ordem, tempos e resposta são simulados e assim identificados na própria tela.

**Simulado:** respostas de IA, fala/escuta do núcleo, agenda, transcrição, resumo
de reunião, saldos, conexões e execução de ações. Não há requisições à API,
acesso ao microfone, gravação, câmeras, OAuth nem controle de dispositivos.
O anexo só exibe o nome do arquivo escolhido; seu conteúdo não é lido ou enviado.

**Leitura opcional:** “Ouvir com a voz do navegador” usa `speechSynthesis` após
clique explícito. Depende das vozes disponíveis no navegador/sistema e não é a
voz final da Órbita. A animação de fala é ilustrativa, sem análise de áudio.

**Persistência:** tema, movimento, intensidade e memórias ficam no
`localStorage`, exclusivamente na chave `orbita-presenca-prototype-v1`.
O restante reinicia ao recarregar. Nenhum dado do app de produção é alterado.

## Ideias de produto incorporadas à proposta

- Sugestões explicáveis, com as memórias que originaram a conexão.
- Memória editável com fonte e confirmação visíveis.
- Rotinas por intenção e sequência de passos legível.
- Aprovações com destinatário, conteúdo e efeito na mesma tela.
- Objetos com “visto por último”, em vez de prometer uma localização atual.
- Um modo foco com temporizador e menos estímulos.
- Resumo de reunião que se transforma em memória.
- Pesquisa com rastreabilidade visual e fontes acessíveis durante a descoberta.

Essas ideias são propostas de experiência, não funcionalidades novas integradas
ao backend. O próximo trabalho, após a escolha da direção visual, seria adaptar
os componentes do aplicativo aos eventos e dados reais existentes.

## Verificação desta entrega

- Revisão neural: dez estados animados em WebGL, claro/escuro, foco, celular,
  clique/Enter, movimento reduzido e chegada progressiva das três fontes
  passaram no percurso `--orb-only`, sem erros JavaScript.
- Pesquisa no chat: fontes persistidas na resposta e interrupção verificadas.
  A repetição do percurso geral desta revisão parou em um timeout de navegação
  ao recarregar Memória; os fluxos gerais abaixo haviam passado na revisão anterior.
- Chrome headless: dez estados, movimento reduzido, conversa e interrupção,
  CRUD e persistência de memória, rotinas, cenas, aprovação, gastos, conexões,
  transcrição demonstrativa, resumo, temporizador, busca e navegação por teclado.
- Revisão visual em desktop claro/escuro, conversa, memória, reuniões, foco e
  celular. As nove telas cabem em 390 px; a visão geral também foi testada em 320 px.
- HTML original funcionando offline via `file://`, sem requisições externas.
- Nenhum erro JavaScript nos percursos verificados. Screenshots `preview-*.png`.
- TypeScript de `apps/web` e `apps/api`: sem erros.
- Suíte geral do repositório: 609 testes passaram, 1 falhou no RAG
  (`packages/core/src/rag/chunk.test.ts:24`, `pageStart` esperado 2, recebido 1).
  Os arquivos de RAG têm alterações de outro trabalho e não foram modificados
  por esta proposta de front. Essa falha não faz parte do protótipo.

Para repetir o QA, com Playwright Python e Chrome instalados e o preview no ar:

```powershell
python prototypes/orbita-presenca/qa.py
python prototypes/orbita-presenca/qa.py --orb-only
python prototypes/orbita-presenca/qa.py --portable-only
```
