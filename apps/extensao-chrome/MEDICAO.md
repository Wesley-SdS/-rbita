# Medição B0: o Chrome do dono (frente B)

Medido em 10/10/2026 nesta máquina (Windows 11 Pro 26200, Chrome 155.0.8059.39 instalado, Chrome for
Testing 149 do cache do Playwright para os testes), pelo próprio código da extensão e do core, não
por ferramenta de fora. O roteiro que gera os números é `test/medicao.test.ts` (roda com
`ORBITA_MEDIR=1`); os JSON brutos ficaram fora do repositório.

## 1. O `browser_toolset_20260801` (descoberto por chamada real)

**Como foi descoberto.** Três jeitos, cruzados: (1) perguntar ao modelo, pela assinatura, a lista e o
esquema da tool que ele recebeu; (2) a documentação da Anthropic (`/agents-and-tools/tool-use/browser-use-tool`);
(3) um laço real com tarefas variadas (preencher formulário, buscar e digitar, abrir e alternar abas),
respondendo cada `tool_use` e registrando o que voltava.

- A definição custa **~6.400 tokens de entrada por chamada** (6.376 medidos na primeira rodada, sem
  nenhum conteúdo de página), antes de qualquer captura.
- **27 membros ligados por padrão**, mais 4 opcionais desligados (`javascript_exec`, `file_upload`,
  `read_console`, `read_network`).
- **A chamada real não é a que o modelo descreve.** Perguntado, o Claude descreve UMA tool `browser` com
  um array `actions`. Na prática cada membro chega como um `tool_use` próprio (`name: "navigate"`,
  `toolset_name: "browser"`, `input` só com os parâmetros dele), como diz a documentação. O código segue
  a chamada real.
- O resultado de `new_tab`, `switch_tab`, `close_tab` e `list_tabs` tem de ser **só** um bloco
  `browser_state` (lista inteira das abas, exatamente uma ativa; `new_tab` com um `tab_opened`): fora
  disso a API devolve 400 (`a non-error tool_result for the 'new_tab' member must have exactly one
  browser_state block`).
- Membros vistos no laço real: `navigate`, `read_page` (`filter: interactive`), `find`, `form_input`
  (inclusive `value: true` para caixa de marcar), `left_click` (por ref e por coordenada),
  `scroll_to`, `type`, `key` (`"Return"`), `wait`, `get_page_text`, `screenshot`, `new_tab`, `list_tabs`.

**Tradução para ações seguras da extensão** (`packages/core/src/navegador/motor.ts`): cada membro vira
uma chamada às MESMAS tools do registro, com sessão, envelope, risco pelo alvo, crítico, fila e trilha.

| Membro | Vira | Observação |
|---|---|---|
| `navigate` (url, back, forward, reload) | `navegador_abrir` (abrir, voltar, avancar, recarregar) | URL com parâmetros não vista vira proposta |
| `new_tab`, `switch_tab`, `close_tab` | `navegador_abrir` (nova_aba, focar_aba, fechar_aba) | só abas do grupo da Órbita |
| `list_tabs` | as abas do grupo (estado) | aba bloqueada nunca aparece |
| `read_page`, `get_page_text`, `find` | `navegador_ler` (árvore, texto, árvore filtrada pela busca) | embrulhado como dado externo |
| `screenshot`, `zoom` | `navegador_ler` acao ver (inteira, região) | campos sensíveis apagados na imagem |
| `left/right/middle/double/triple_click`, `hover` | ponto → `elementFromPoint` → ref → `navegador_agir` | o risco é do ELEMENTO, não do ponto |
| `form_input` | `navegador_agir` (preencher, selecionar, marcar) | senha, cartão e código recusados |
| `scroll`, `scroll_to` | `navegador_agir` rolar | |
| `type`, `key` | `navegador_agir` digitar, tecla | Enter num formulário vira proposta |
| `wait` | espera no laço (até 30 s) | |

**Ficam de fora** (desligados no `configs` e, se chamados, `is_error`): `left_click_drag`,
`left_mouse_down`, `left_mouse_up`, `mouse_move` e `hold_key` (sem um alvo único para conferir: o botão
fica apertado entre duas chamadas ou o arrasto vai de um ponto a outro), e os quatro opcionais:
`javascript_exec` (rodar código é RCE, PRD §2.4), `file_upload` (efeito externo sem alvo visível),
`read_console` e `read_network` (dado que a página não mostra ao dono).

## 2. Tokens do retrato de páginas reais

Contados pelo `count_tokens` da própria API (assinatura, `claude-sonnet-5-5`), no formato exato que vai
ao modelo (`button "Enviar" [ref_3]`, embrulhado em `<dado_externo>`). Em parênteses, a estimativa do
`gpt-tokenizer`, que fica de 30% a 45% abaixo do número real para texto em português.

| Página | Interativos (tela) | Visíveis (tela) | Tudo (página inteira) | Texto principal | Escondidos tirados |
|---|---|---|---|---|---|
| g1.globo.com | 16 el · **404** (269) | 23 el · **562** | 74 el · **2.142** | **1.071** | 3 el + 8 trechos |
| pt.wikipedia.org (Google Chrome) | 73 el · **1.247** | 90 el · **1.607** | 795 el · **15.694** | **16.335** | 15 el + 2.464 trechos |
| github.com/microsoft/playwright | 20 el · **481** | 26 el · **616** | 38 el · **810** | **4.448** | 4 el + 106 trechos |
| news.ycombinator.com | 164 el · **2.715** | 167 el · **2.863** | 236 el · **4.017** | **1.855** | 0 |
| gov.br | 17 el · **371** | 22 el · **474** | 119 el · **2.445** | **600** | 16 el + 80 trechos |
| developer.chrome.com (chrome.debugger) | 67 el · **1.256** | 79 el · **1.470** | 276 el · **4.722** | **4.387** | 6 el + 27 trechos |

Leitura: o retrato da TELA (o padrão `visiveis`) fica entre **~470 e ~2.900 tokens**; a página inteira
passa de 15 mil numa Wikipédia. Por isso o padrão é a tela, e `navegador.elementosMax` (250) e
`navegador.textoMaxCaracteres` (20.000) cortam o resto. Uma captura 1280x800 sai de 90 a 250 KB e, pela
regra da Anthropic (largura × altura / 750), ~1.365 tokens: mais cara que a árvore em 5 das 6 páginas.
"Escondidos tirados" são os elementos e trechos de texto que a sanitização removeu (invisíveis,
`aria-hidden`, fora da página, cor do fundo). Na Wikipédia são as caixas recolhidas e a navegação.

Tempo de ler na página (sem rede): de 86 ms a 7,5 s; o pior foi a Wikipédia inteira (795 elementos).

## 3. O depurador em aba sem foco

**Funciona, mas a captura de aba em segundo plano era instável.** `chrome.debugger.attach` leva ~7 ms e
`Page.captureScreenshot` numa aba que não está na frente devolveu a imagem em 92 ms numa sonda isolada,
mas no laço de teste chegou a passar de 15 s (a aba de fundo não pinta quadro novo e a captura espera
um). A correção foi ligar `Emulation.setFocusEmulationEnabled` só durante a captura (sonda: de ~2 s para
~100 ms) e desligar logo depois; com ela o teste de ponta a ponta passou duas vezes seguidas. O clique
por CDP em aba sem foco funcionou (o botão "Ver ajuda" abriu a ajuda na aba de fundo).

Números de uma ordem completa em aba de fundo (anexar, pôr no grupo, mascarar, capturar), em três
rodadas: 0,96 s / 5,0 s / 24,6 s para a captura, e 0,59 s / 8,0 s / 17 s para o clique. A rodada de 24,6 s
foi com um `pnpm install` rodando ao mesmo tempo: nesta máquina a carga pesa mais que o foco.

**Achado que virou correção:** com a máquina carregada, o tempo entre "preparar o alvo" e o clique
passou da janela de ação da Órbita (`navegador.agindoMs`, 800 ms), e o clique da PRÓPRIA Órbita, que o CDP
entrega como `isTrusted`, foi lido como "o dono mexeu": a sessão pausou e o depurador foi solto no meio
do comando (`Detached while handling command`). A marca agora é renovada imediatamente antes e depois de
cada entrada (`comAgindo` em `executor.ts`).

## 4. O peso da faixa amarela

Com o depurador anexado, o Chrome mostra "… começou a depurar este navegador [Cancelar]" no topo da
janela. Medido numa janela visível (Chrome for Testing 149, 1280x900): a área da página cai de **805
para 749 px de altura, 56 px** (7% da altura útil). A faixa fica enquanto houver sessão com ação no
Chrome; fora de sessão, a captura anexa e solta na hora (a faixa pisca). O "Cancelar" dela é tratado
como Parar (`chrome.debugger.onDetach` com `canceled_by_user`). Decisão do dono: a faixa FICA (não
instalar por política).

## 5. Latência por ação (mediana de 10, sem modelo)

Do core até a extensão e de volta, numa página local, aba na frente:

| Ordem | ms |
|---|---|
| listar abas | 2 a 14 |
| ler a árvore (interativos) | 8 a 17 |
| ler o texto | 7 a 21 |
| descrever um alvo | 12 |
| captura 1280x800 | 85 a 90 |
| preencher um campo | 356 a 401 |
| clicar | 371 a 446 |

Clicar e preencher passam de 300 ms porque incluem rolar o alvo para a vista, conferir a assinatura,
as duas marcas de "agindo" e a espera de 300 ms pela navegação que o clique possa causar. A meta do PRD
(§14.2, "< 500 ms por passo, sem o modelo") foi atingida em todas.

## 6. Parar

Do clique no botão Parar da barra da aba até a extensão soltar o depurador e marcar "parado", e até o
core marcar a sessão como `parada` (5 amostras): extensão **17, 40, 141, 171, 333 ms** (mediana 141);
core **43, 59, 146, 234, 399 ms** (mediana 146). A medição soma o tempo de perguntar o estado (o laço de
espera consulta a cada ~10 ms mais o custo da consulta), então o número real é um pouco menor. A meta
de 300 ms (F6) foi atingida na mediana, não em todas as amostras.

## 7. Tarefa delegada de verdade (Claude da assinatura)

`claude-sonnet-5-5` com o `browser_toolset_20260801`, no formulário da bancada, com o objetivo
"preencha Nome, Valor, Categoria, marque a declaração e clique em Enviar":

- **2 rodadas do modelo**: (1) `navigate` + `read_page`; (2) quatro `form_input` + `left_click` em
  "Enviar" + `read_page`. 6.376 e 6.816 tokens de entrada, 98 e 255 de saída: **13.545 tokens no total**.
- O modelo levou 1,8 s e 2,3 s por rodada. A tarefa inteira levou 41,6 s, quase tudo fora do modelo
  (crítico mockado nesta medição, mas trilha no banco, aviso ao dono e as esperas das ações).
- Os quatro campos foram preenchidos na página; o clique em "Enviar" virou **proposta na fila**
  ("clicar button "Enviar" em 127.0.0.1 (envia um formulário)") e o formulário **não** foi enviado.
- **Achado que virou correção:** na primeira tentativa a tarefa parou 10 minutos esperando "login",
  porque o formulário tem um campo de senha. A detecção de login agora exige senha vazia E sinal de
  tela de login (botão ou título com entrar/login, `autocomplete=current-password`, ou no máximo um
  outro campo).

Os roteiros (B4) foram medidos no teste de unidade com o laço de verdade e o modelo falso: a primeira
execução gastou 18.000 tokens e a segunda, pelo roteiro, **0** (exigência: menos de 20%).

## 8. Como carregar a extensão

- **Chrome de marca 155: `--load-extension` é ignorado.** Lançado com perfil temporário e as flags
  `--disable-extensions-except` e `--load-extension`, o service worker da extensão nunca apareceu. No
  Chrome do dono a instalação é manual: `chrome://extensions`, Modo do desenvolvedor, "Carregar sem
  compactação" na pasta `dist` (README).
- **Chrome for Testing 149 (cache do Playwright): funciona**, em modo sem janela inclusive. É o que os
  testes de ponta a ponta usam, sempre com perfil temporário.
- **Native messaging no Chrome for Testing:** com a ponte registrada nas chaves do Chromium e do
  "Chrome for Testing" em HKCU, a extensão conectou pela ponte (`via: nativo`). O teste não isolou qual
  das duas chaves o CfT leu.

## 9. O que NÃO deu para medir

- **A extensão no Chrome do dono.** Por regra desta tarefa, nada foi instalado no Chrome pessoal: toda
  medição é no Chrome for Testing. O peso da faixa e o comportamento em aba sem foco no Chrome 155 de
  marca não foram medidos.
- **Um card do Jira e um site com login de verdade.** Não há credencial de teste; a leitura de páginas
  logadas, o fluxo de login real (avisar, esperar, retomar) e captcha de verdade ficaram só nos testes com
  a bancada local e com o modelo falso.
- **A bancada F8 com os modelos reais da cadeia** (quantas vezes o modelo tentou obedecer à injeção).
  A rodada estrutural (o "Claude" falso que obedece a tudo) está no teste de ponta a ponta e deu zero
  escapes; a rodada real com Gemini/OpenAI não foi feita.
- **O crítico real.** Em todas as medições acima o crítico respondeu "alinhado" sem modelo; o tempo e os
  vetos de um crítico de verdade não estão nos números.
- **A latência pelo native messaging** (só se confirmou que conecta e responde uma ordem).
- **Aceite B0 da voz: resolvido.** A nota antiga (o teste do teto reprovava com 126 + 2 = 128) ficou velha: os
  domínios do controle do PC chegam à voz por duas funções de despacho (`controle/voz.ts`). Medido em 11/10/2026
  rodando `tools/sensiveis.test.ts` (passa): a sessão de voz declara **127 de 128** (123 tools não sensíveis + 2 do PC
  + 2 do MCP), e o pior caso do registro inteiro também dá 127. Tool nova fora dos domínios do PC passa do teto.
- **A rodada real da F8 continua NÃO feita** (auditoria de 11/10/2026): sem `CLAUDE_CODE_OAUTH_TOKEN` nesta máquina e
  sem chave de Gemini ou OpenAI para a bancada, só existem os testes estruturais (o "Claude" falso que obedece a tudo:
  e-mail, URL montada com o código e a ordem desenhada numa imagem, todos parando na fila). Quantas vezes um modelo de
  verdade tenta obedecer, e quantas o crítico veta, segue sem número.
- **`list_tabs` com o grupo vazio pela API real.** Não deu para conferir por chamada à assinatura (sem token nesta
  máquina) se um `browser_state` sem abas devolve 400. O motor agora abre uma aba em branco no grupo antes de
  responder, então o caso não acontece; a confirmação pela API fica para quando houver token.
