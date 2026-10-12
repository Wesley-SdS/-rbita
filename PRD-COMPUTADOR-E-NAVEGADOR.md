# PRD: AS MÃOS DA ÓRBITA (COMPUTADOR, TERMINAL, CHROME E ANEXOS)

> A Órbita passa a agir no computador do dono em três frentes: (A) o Windows e o terminal, por um
> serviço local novo, (B) o Chrome de verdade, com os logins dele, por uma extensão própria, e
> (C) abrir e entender anexo de e-mail de qualquer tipo. Ler é livre dentro do que o dono liberou.
> Agir acontece dentro de uma **sessão de controle** que o dono aprova, com teto de passos e de
> tempo, e tudo que tem efeito fora da tela (enviar, comprar, apagar, comando que muda alguma coisa)
> continua indo para a fila de aprovação, como hoje.
>
> Versão 2, de 2026-10-10. O estado de partida foi verificado no código, não presumido. A pesquisa
> externa foi feita na mesma data, e as fontes estão no §16. A v2 traz as respostas do dono
> (**DECIDIDO**), a frente C e o teste real do computer use do Claude pela assinatura (§5.6). O que
> ainda está marcado como **PROPOSTO** espera o dono.

---

## 1. Por que este PRD existe

O dono passa o dia no computador: terminal, VS Code, Jira, GitHub, Slack, Meet, banco, planilha.
Hoje a Órbita consegue **olhar** a tela uma vez (`seeScreen()` em `console/use-voice.ts`, que manda
um quadro para `POST /api/vision`), mas não consegue fazer nada nela. "Roda os testes e me diz o que
quebrou", "abre o card do Jira e resume", "fecha o Spotify e abre o projeto", "quanto de disco
sobrou", "preenche o reembolso com esse cupom": tudo isso exige mãos.

O assunto só aparece no backlog (`CHECKLIST.md:169-170`, "Extensão de navegador" e "Desktop nativo
+ computer-use"). O `BRIEFING-JARVIS.md` não fala disso.

São duas frentes porque o mecanismo é diferente (APIs do Windows de um lado, extensão do Chrome do
outro), o risco é diferente (o navegador está cheio de conteúdo de terceiro e tem os logins do
dono) e cada uma entrega valor sozinha. As duas dividem a mesma fundação (§6): sessão de controle,
risco por alvo, trilha, crítico de alinhamento e botão de parar.

A frente C (anexos, §8.1) entrou na v2 depois de uma falha real: o dono pediu para a Órbita ver um
e-mail com anexo e ela não conseguiu. Ela não depende das mãos e vem primeiro.

### O que este PRD NÃO é

- **Não é plugar um MCP pronto e deixar o modelo dirigir.** Os servidores prontos (Windows-MCP,
  Desktop Commander, Playwright MCP, Chrome DevTools MCP) expõem tools genéricas: `click` não sabe se
  o botão é "Comprar". O gate da Órbita é derivado do risco pelo registro (§5.1, §5.7), e aqui o
  risco depende do **alvo**, não da tool. O Playwright MCP diz em texto que "não é uma fronteira de
  segurança". Eles servem para a sondagem (F0), não como produto.
- **Não é acesso remoto ao PC de fora de casa.** O serviço escuta só em `127.0.0.1`. Controlar de
  fora (pelo celular, na rua) só acontece pelos canais que já existem (WhatsApp "Eu", Telegram), com
  as mesmas travas, e começa desligado.
- **Não é rodar como administrador.** Nenhuma peça roda elevada, e isso é uma trava (§2.7).
- **Não é substituir o Claude Code.** Programar continua com ele. A Órbita roda comando, lê saída e
  resume. Delegar uma tarefa de código ao Claude Code fica para depois (§15).
- **Não é multi-tenant nem multi-máquina na v1** (§5.5). O modelo de dados aceita mais de um PC, mas
  a v1 controla o PC onde o `apps/api` roda.

---

## 2. O que a pesquisa ensinou (e vira regra)

1. **Nenhum modelo é imune a prompt injection, então a defesa tem de ser estrutural.** A Anthropic
   mediu 1% de sucesso contra o Opus 4.5 com atacante adaptativo (nov/2025), a Gray Swan chegou a
   63% em 100 tentativas no mesmo modelo, e o Claude in Chrome só chegou a 0% (GA, 26/08/2026) com
   classificador de ações por cima do modelo. Na Órbita a trava é o código, como já é no §5.1.
2. **O gate é pelo alvo, não pela tool.** Clicar em "Ver mais" e clicar em "Pagar" são a mesma tool
   e riscos opostos. O risco é recalculado a cada chamada a partir do que vai ser tocado (§5.3).
3. **O modelo nunca amplia as próprias permissões.** A Zenity Labs (publicado em 05/08/2026) levou o
   Claude in Chrome de um e-mail com injeção até tomar conta do Gmail, do Drive e do Slack: a
   injeção acrescentava domínios aprovados pelo `update_plan` e rodava JavaScript pelo
   `javascript_tool` sem aprovação. Aqui não existe tool que mude site liberado, pasta liberada, app
   liberado ou sessão. Isso só muda pela tela, com `OwnerGuard`.
4. **Não existe tool de JavaScript nem de "rodar código" no navegador.** O próprio Playwright MCP
   chama o `browser_run_code_unsafe` de "equivalente a RCE".
5. **Localhost não é confiança.** A CVE-2026-25253 (OpenClaw, jan/2026): uma página web abria
   WebSocket para o gateway local, roubava o token e assumia o PC. Todo canal local exige token,
   confere `Origin` e recusa CORS.
6. **Acessibilidade primeiro, visão de reserva.** No UFO2 da Microsoft (com o1, WindowsAgentArena):
   só árvore de acessibilidade (UIA) deu 25,3%, só visão (OmniParser) 20,8% e híbrido 27,9%. A
   árvore é texto, barata, funciona com qualquer modelo (inclusive local) e dá alvo exato. O
   screenshot entra quando a árvore não basta.
7. **Nunca elevado é trava de graça.** O `SendInput` respeita a UIPI: um processo de integridade
   média não consegue injetar clique em janela elevada nem no prompt do UAC. Se o serviço nunca roda
   como administrador, o modelo não consegue aprovar UAC nem mexer em app elevado, por construção.
8. **Regra de Dois (Meta, out/2025).** Sem supervisão humana, um turno pode ter no máximo duas
   destas três coisas: entrada não confiável, dado sensível, mudança de estado ou comunicação
   externa. Tela e página são sempre entrada não confiável, então agir sozinho em cima delas exige
   o envelope aprovado e o gate.
9. **Navegação sem supervisão fica fora do perfil real.** A Brave (sobre o Comet) e a OpenAI (modo
   sem login do Atlas) chegaram à mesma conclusão: isolar a navegação do agente da navegação do
   dono. Rotina da madrugada nunca roda no Chrome com os logins dele (B6).
10. **O crítico vê só os metadados da ação.** O "User Alignment Critic" do Chrome (Google, dez/2025)
    é um segundo modelo que recebe o pedido do usuário e a ação proposta, nunca a página, e pode
    vetar. Como não lê a página, uma injeção na página não alcança o crítico.

---

## 3. Decisões propostas

| Tema | Proposta |
|---|---|
| Executor do Windows | **PROPOSTO:** serviço local novo, `apps/maos`, fora do `apps/api`. Nasce no logon do dono (Agendador de Tarefas), na sessão interativa e em integridade média. O `tsx watch` reinicia o api a cada arquivo salvo, um comando travado não pode derrubar o processo vivo, e o executor não pode enxergar o banco nem os segredos da Órbita |
| Linguagem do `apps/maos` | **DECIDIDO (10/10):** Python 3.12 com FastAPI, no padrão do `apps/perception` (venv próprio, pytest). UIA por `uiautomation`, captura por `windows-capture` (ou `dxcam`), entrada, atalho, gancho e Job Object por `pywin32`/`ctypes`, PTY por `pywinpty`. O parser do PowerShell roda num processo `pwsh` que fica aberto (§7, A3) |
| Motor do computer use | **PROPOSTO (a partir do teste de 10/10, §5.6):** com o Claude na cadeia, a Órbita usa as tools de computer use do próprio Claude (`computer_toolset_20260801` e `browser_toolset_20260801`), que a assinatura aceita. Com Gemini ou OpenAI, usa as tools próprias da Órbita. Nos dois casos as mesmas travas valem |
| Pelo celular | **DECIDIDO (10/10):** a conversa "Eu" do WhatsApp entra nos canais desde a v1, junto com tela e voz. O Telegram fica de fora |
| Screenshot na nuvem | **DECIDIDO (10/10):** pode ir para o modelo na nuvem, com os apps ocultos pintados de preto antes de sair |
| "Manda" abre sessão | **DECIDIDO (10/10):** pode. Abrir sessão é `efeito_externo` e segue as regras de aprovação falada que já existem |
| Apps de chamada | **DECIDIDO (10/10):** Teams, Meet e Zoom não ficam ocultos na captura |
| Executor do Chrome | **PROPOSTO:** extensão MV3 própria (`apps/extensao-chrome`) com `chrome.debugger`. É o único caminho para o perfil real: desde o Chrome 136 o `--remote-debugging-port` é ignorado no perfil padrão. Mesmo desenho do Claude in Chrome |
| Canal da extensão | **PROPOSTO:** WebSocket para `127.0.0.1:3010` com token pareado e `Origin` conferido. Native messaging fica como endurecimento (B7) |
| Quem decide | **PROPOSTO:** toda decisão (risco, gate, crítico, envelope) mora em `packages/core`. O `apps/maos` e a extensão só executam, e repetem as travas duras do lado deles (defesa em profundidade) |
| Tools | **PROPOSTO:** tools nativas do registro, em pt-BR, nos domínios `controle`, `terminal`, `arquivos`, `computador` e `navegador`. Nada entra por MCP |
| Modelo | **PROPOSTO:** o Claude da assinatura é o motor principal (§5.6). Sem ele, a árvore de acessibilidade funciona com qualquer modelo (inclusive local), e o screenshot vai como imagem para quem enxerga |
| Quem pode | **PROPOSTO:** só o dono. Estes domínios nunca entram em `telegram.dominiosDaFamilia`, nunca rodam em turno disparado por evento de terceiro (`eventoDeTerceiro`) e nunca rodam no automático do WhatsApp |
| Sem supervisão | **PROPOSTO:** rotina e regra podem rodar comando de leitura e propor comando com efeito (vai para a fila). Controlar a tela sozinho não existe na v1. Navegador sozinho só no perfil dedicado (B6) |

---

## 4. Estado de partida (verificado em 2026-10-10)

### 4.1 O que a Órbita já tem e serve

| Peça | Onde | Como serve |
|---|---|---|
| Registro com risco (`leitura`, `escrita`, `efeito_externo`, `perigoso`), `authorize`, `preparar`, `summarize` | `packages/core/src/tools/registry.ts` · `toToolSet` | É o eixo de tudo. Falta só o risco poder subir conforme a entrada (F1) |
| Override de risco pela tela (só sobe) | `effectiveRisk` · tabela `tool_config` | Continua valendo para as tools novas |
| `requires.available: () => boolean` | `ToolDef.requires` | Esconde as tools quando o `apps/maos` ou a extensão estão desligados |
| Fila de aprovação, aprovar pela tela, pela frase "manda" e pelo botão do Telegram | `action_queue` · `actions/aprovar.ts` · `actions/por-frase.ts` · `telegram/receber.ts` | Reaproveitada sem mudança. `perigoso` já só sai pela tela |
| Serviço local com token compartilhado e recusa de `Origin` | `apps/perception` (`PERCEPTION_TOKEN`, `x-orbita-percepcao`) · `perception/client.ts` (exige `isLocalUrl`) | É o padrão que o `apps/maos` copia |
| Fila de trabalho pesado com progresso e cancelamento | `packages/core/src/jobs/` | Comando que passa de alguns segundos vira trabalho (A2) |
| Event bus com outbox | `packages/core/src/events/` | Eventos `controle.*` para regras e para a trilha |
| Settings com zod, tela automática, `OwnerGuard` | `settings/defs.ts` · `settings-panel.tsx` | Todo limite deste PRD é chave nova (§10) |
| Cartões da tela | `chat/cartoes-da-tela.ts` | Cartão de "Órbita no controle". Hoje não tem campo de imagem |
| Ver a tela uma vez | `seeScreen()` em `use-voice.ts` → `routes/vision.ts` | Continua. Ver §12.9 |

### 4.2 O que NÃO existe

- **Nenhuma execução de comando no código de produto.** Não há `child_process`, `spawn`, `execFile`,
  Playwright, Puppeteer nem CDP. Os `exec(` do repositório são todos `RegExp.exec`.
- **O MCP não alcança serviço local.** Só fala HTTP streamable e `connect()` chama `assertPublicUrl`
  (`packages/core/src/net/ssrf.ts`), que bloqueia loopback e LAN. Não há stdio.
- **Nenhuma tool devolve imagem ao modelo.** Não há `toModelOutput`. A imagem é sempre narrada à
  parte e volta como texto.
- **O risco não depende da entrada.** `needsApproval(def.risk)` olha só o risco declarado.
- **O executor pós-aprovação não sabe de onde veio o pedido.** `executeAction` chama
  `def.run(input, { userId })`, sem canal, origem nem quem pediu. Máquina, sessão e alvo têm de ir
  fixados no payload pelo `preparar`.
- **Não existe trilha genérica de execução de tool.** A única auditoria de verdade é a
  `identity_audit`, e o `BRIEFING-JARVIS.md` §10 ainda lista "sem audit log" como risco.
- **O `apps/voice` não tem autenticação** e responde com `allow_origins=["*"]`. Não é deste PRD,
  mas com um executor local na mesma máquina a lição do §2.5 vale para ele também (§15).

### 4.3 O que existe lá fora, e por que não é plugado direto

| Produto | O que é | Por que não serve como produto aqui |
|---|---|---|
| Windows-MCP (CursorTouch, 8,6k estrelas, MIT) | 21 tools com UIA + visão, inclusive PowerShell, Registro e Processo | Tudo ligado por padrão, telemetria ligada, risco genérico. Ótima referência e ótima sondagem (F0) |
| Desktop Commander MCP | Terminal e arquivos com sessões de processo | O README diz que não é sandbox e que `blockedCommands` "pode ser contornado" |
| Playwright MCP `--extension` | Controla o Chrome por extensão, com snapshot e refs | Diz em texto que não é fronteira de segurança. `--allowed-origins` não pega redirecionamento |
| Chrome DevTools MCP `--autoConnect` (Chrome 144+) | Liga no perfil real por `chrome://inspect` | Pede "Permitir" a cada sessão (ruim para processo 24/7), manda estatística de uso por padrão |
| Claude in Chrome | Extensão + host nativo + Claude | É o modelo de arquitetura. É do Claude Code, não da Órbita |
| Agent Workspace e registro de MCP do Windows (ODR) | Conta de agente separada, MCP contido | Preview, exige build 26220.7262+ e app empacotado. Esta máquina está no 26200. Revisitar (§15) |
| UFO2, Agent S3, UI-TARS | Agentes de pesquisa em Python | Referência de técnica (híbrido UIA + visão), não de produto |
| Stagehand, browser-use | Bibliotecas de agente de navegador | Úteis no perfil dedicado (B6). No perfil real esbarram no Chrome 136 |

---

## 5. Arquitetura

```
 dono (tela · voz · WhatsApp "Eu" · Telegram)
        │
        ▼
 apps/api ── chat / voz / rotinas ──► registro de tools (packages/core)
        │                                   │
        │      ┌────────────────────────────┼───────────────────────────────┐
        │      │ controle/  sessão · risco por alvo · crítico · trilha · parar│
        │      └──────────────┬──────────────────────────────┬──────────────┘
        │                     │ HTTP 127.0.0.1 + token        │ WebSocket 127.0.0.1:3010
        │                     ▼                               ▼  (token pareado + Origin)
        │           apps/maos (Python, sessão do dono)  apps/extensao-chrome (MV3)
        │           · terminal (Job Object, env mínimo) · chrome.debugger (CDP)
        │           · arquivos (pastas liberadas)       · grupo de abas "Órbita"
        │           · UIA + captura + SendInput         · máscara de senha ANTES de sair
        │           · atalho de parar, borda na tela    · borda na aba + botão Parar
        │           · espelho do envelope (recusa fora) · espelho dos sites (recusa fora)
        ▼
 action_queue (gate) · controle_sessao · controle_passo · event_log
```

### 5.1 Quem faz o quê

- **`packages/core/src/controle/`** é o cérebro: abre e fecha sessão, calcula o risco a partir do
  alvo, chama o crítico, grava a trilha, emite eventos e recebe o "parar".
- **`apps/maos`** e a **extensão** são mãos. Recebem uma ordem concreta ("clique no elemento 17 da
  janela 0x3A2"), executam e devolvem o resultado. **Repetem as travas duras do lado deles:** o
  `apps/maos` recusa entrada em app fora do envelope ativo e recusa subir elevado; a extensão
  recusa domínio bloqueado e mascara campo sensível antes de mandar qualquer coisa. Se o api tiver
  um bug, as mãos continuam recusando.
- **Uma ordem com alvo é conferida na hora de executar.** O payload aprovado leva a assinatura do
  alvo (papel, nome, janela ou URL). Se a tela mudou entre a proposta e a execução, a mão recusa
  com "a tela mudou" em vez de clicar no que estiver lá agora (tempo entre checar e usar, §12.6).

### 5.2 Canais e autenticação

- **api → `apps/maos`:** HTTP em `127.0.0.1:<maos.porta>`, cabeçalho `x-orbita-maos` com token de
  `MAOS_TOKEN` (no `.env` da raiz, lido pelos dois). O `apps/maos` **recusa subir sem token**
  (diferente do `PERCEPTION_TOKEN`, que é opcional), recusa qualquer requisição com `Origin` e não
  responde CORS. O cliente (`packages/core/src/maos/client.ts`) exige `isLocalUrl`, como o da
  percepção.
- **extensão → api:** WebSocket em `ws://127.0.0.1:3010/api/navegador/canal`. Primeiro o dono pareia:
  clica "Parear extensão" na tela e recebe um código de 6 dígitos que vale 5 minutos, digita o
  código no popup da extensão, e a extensão troca o código por um token longo. Só o hash do token
  fica gravado (`navegador_extensao`). O token vai na primeira mensagem, nunca na URL. O api confere
  `Origin: chrome-extension://<navegador.extensaoId>`, e o ID é fixo pela chave `key` no manifesto.
  Keepalive de 20 s (o service worker MV3 morre com 30 s parado), `minimum_chrome_version: 118`.
  A tela permite revogar o token.

### 5.3 Como o risco é calculado

O risco declarado da tool é o piso. `elevarRisco` (F1) olha a entrada já fixada pelo `preparar` e só
pode subir. A tabela abaixo é a proposta inicial. Listas, rótulos e categorias são dados (§10), não
constantes.

| Ação | Risco | Por quê |
|---|---|---|
| Ver janelas, árvore UIA, sistema (CPU, disco), abas, ler página liberada | `leitura` | Não muda nada |
| Comando de terminal que só tem comandos da lista de leitura, sem redirecionamento, substituição, `iex`, base64 nem caminho fora das pastas | `leitura` | Lista fechada, parse limpo |
| Volume, mídia (tocar, pausar), bloquear a tela | `escrita` | Como luz e música no §5.1: reversível e sem terceiro |
| Clicar, digitar, rolar e abrir app ou site **dentro de uma sessão ativa** e de um app ou site do envelope | `escrita` | O dono aprovou o envelope. O crítico confere cada passo |
| Abrir sessão de controle | `efeito_externo` | É a aprovação do envelope |
| Qualquer comando de terminal fora da lista de leitura | `efeito_externo` | Mostrado por inteiro na proposta |
| Escrever arquivo, mandar arquivo para a lixeira, encerrar processo | `efeito_externo` | A proposta mostra o diff ou o caminho |
| Clicar em alvo cujo rótulo ou papel bate com enviar, publicar, comprar, pagar, confirmar, excluir, assinar ou compartilhar; enviar formulário; subir arquivo; site fora do envelope | `efeito_externo` | Efeito fora da tela |
| Comando que não deu para analisar, com elevação (`RunAs`, `sudo`), `Invoke-Expression`, `-EncodedCommand`, caminho UNC, Registro, apagar recursivo, baixar e executar | `perigoso` | Só pela tela (§5.1, decisão 9.5) |
| Digitar em campo de senha, cartão ou código de uso único; agir em site ou app de categoria bloqueada | recusado | Não é risco a aprovar: a Órbita não faz isso |

### 5.4 Sessão de controle (o envelope)

Aprovar clique por clique mata o uso, e não aprovar nada é inaceitável. O meio-termo é o padrão
"planejar e executar" (arXiv 2506.08837): o dono aprova **um envelope** e a Órbita age dentro dele.

- `controle_iniciar` propõe: objetivo em uma frase, o pedido original do dono (texto literal), alvo
  (`computador`, `navegador` ou os dois), apps ou sites permitidos, teto de passos, teto de minutos.
- A proposta vai para a `action_queue` como qualquer `efeito_externo`: aprova-se na tela, falando
  "manda" ou pelo botão do Telegram.
- Ativa, a sessão libera as ações `escrita` daquele envelope. Tudo que é `efeito_externo` continua
  pedindo aprovação **dentro** da sessão. `perigoso` continua só pela tela.
- Acabou o teto de passos ou de tempo, a sessão pausa e pede mais pela mesma fila. **Não existe tool
  que amplie o envelope** (§2.3): ampliar é propor um envelope novo.
- O envelope ativo é espelhado no `apps/maos` e na extensão, que recusam alvo fora dele.

### 5.5 Tela e página são DADO (§5.2)

- O que vem da tela, da página e da saída do terminal entra no contexto embrulhado num bloco
  marcado como conteúdo de terceiro, com a regra do `SYSTEM_PROMPT` valendo.
- A extensão tira antes de mandar: elemento invisível (`display:none`, tamanho zero, fora da área
  visível, `aria-hidden`), comentário HTML, o fragmento `#` da URL (o vetor do HashJack) e caracteres
  de controle no título da aba.
- `navegador_extrair` devolve dado **tipado** (campos com zod). O texto livre da página não volta
  como prompt para o turno que decide ações: é a versão leve do CaMeL (DeepMind), que separa quem
  planeja de quem lê o dado não confiável.

### 5.6 Computer use do Claude: testado pela assinatura em 10/10/2026

**O que é.** "Computer use" é o nome que a Anthropic dá a um jeito de o Claude controlar uma tela.
Ele recebe um screenshot, responde com uma ação ("clique em 640,320", "digite isto", "aperte
Enter"), quem chamou executa e devolve o screenshot seguinte. **O Claude não toca no computador.**
Ele só diz o que fazer. Quem clica de verdade são as mãos da Órbita (`apps/maos` no Windows, a
extensão no Chrome). Por isso a pergunta nunca foi "computer use ou não": as mãos existem nos dois
casos. A pergunta era **quem decide o próximo passo**:

- o Claude, com a tool de computer use dele (treinada para isso, enxerga a tela, acerta mais);
- ou o modelo que estiver na cadeia, com as tools próprias da Órbita (`computador_agir`,
  `navegador_agir`), lendo a árvore de acessibilidade.

**O teste.** Um pedido mínimo pela assinatura (token OAuth do Claude Code, o mesmo caminho do
`resolveModel`), pedindo "tire um screenshot":

| Modelo | Tool | Resultado |
|---|---|---|
| `claude-sonnet-5-5` | `computer_toolset_20260801` | 200, respondeu `screenshot` |
| `claude-opus-5-5` | `computer_toolset_20260801` | 200, respondeu `screenshot` |
| `claude-sonnet-5-5` | `browser_toolset_20260801` | 200, respondeu `screenshot` |
| `claude-opus-5-5` | `browser_toolset_20260801` | 200, respondeu `screenshot` |
| `claude-opus-5` | `computer_20251124` (versão antiga) | 200, respondeu `screenshot` |
| `claude-sonnet-5-5` | `computer_20251124` | 400: os modelos 5.5 só aceitam o toolset |

O toolset não aceita `name` nem o tamanho da tela na definição (`{ "type":
"computer_toolset_20260801" }` e nada mais). O `browser_toolset_20260801` não estava na pesquisa:
apareceu na lista de tipos que a própria API devolveu no erro, e é a tool de navegador do Claude in
Chrome.

**Decisão proposta.**

1. **Com o Claude na cadeia, ele é o motor.** No computador, `computer_toolset_20260801`. No Chrome,
   `browser_toolset_20260801`. Na assinatura, cada passo não custa nada a mais.
2. **As travas não mudam.** Cada ação que o Claude devolve vira uma ordem para as mãos e passa pelo
   mesmo caminho das tools próprias: envelope, risco por alvo, crítico, fila e trilha.
   - O clique por coordenada é **traduzido em elemento antes de executar**: o `apps/maos` pergunta à
     UIA o que está naquele ponto (`ElementFromPoint`), e a extensão faz o mesmo com
     `document.elementFromPoint`. Assim o "clique em 640,320" vira "clique no botão Enviar", e o
     risco pelo alvo continua valendo.
   - Digitar só tem efeito em campo de senha, e isso é conferido no elemento que tem o foco.
3. **Sem o Claude** (cadeia caiu para Gemini, OpenAI ou local), as mesmas tarefas rodam com as
   tools próprias e a árvore de acessibilidade. O Gemini 3.5 Flash e a OpenAI também têm computer
   use nativo, e entram depois pelo mesmo tradutor.
4. **O SDK atrasado.** O `@ai-sdk/anthropic@4.0.16` do repositório só conhece até
   `computer_20251124`. O toolset novo entra pelo `oauthFetch` (acrescentando a tool no corpo) ou
   por atualização do SDK. É o primeiro passo da A6 (§12.14).

---

## 6. Fundação comum

### F0. Sondagem antes de escrever código

- Rodar por uma semana, **fora da Órbita**, o Windows-MCP (com PowerShell, Registro, FileSystem,
  Process e a telemetria desligados) e o Playwright MCP `--extension` num **perfil secundário** do
  Chrome, com `browser_run_code_unsafe` desligado, em 20 tarefas reais do dono escritas antes
  (§14.1).
- Medir: árvore UIA dos apps do dono (VS Code, Chrome, Teams, Explorer, Spotify, WhatsApp Desktop),
  tokens por snapshot e por screenshot, passos por tarefa, onde a árvore falha e a visão salva.
- Medir o mesmo conjunto com o `computer_toolset_20260801` do Claude (a assinatura aceita, §5.6)
  contra a árvore de acessibilidade com as tools próprias: taxa de acerto, passos e tempo.
- Conferir: o comportamento do `chrome.debugger` em aba sem foco; o build do Windows.
- **Aceite:** um relatório curto (`apps/maos/MEDICAO.md`, como o `apps/perception/MEDICAO.md`) com os
  números, que calibra os tetos do §10 e as metas do §14.

### F1. Risco que sobe conforme a entrada

- `ToolDef.elevarRisco?(fixo, ctx) => Promise<ToolRisk>`, chamado em `toToolSet` **depois** do
  `preparar`. O risco efetivo é o maior entre o declarado, o override da tela e o elevado. Nunca
  desce.
- O resultado vai para o resumo da proposta ("comando com efeito: `pnpm install`") e para
  `payload.risco`, para o `aprovarPorFrase` e o botão do Telegram aplicarem a regra do `perigoso`
  sem depender do `getTool(kind)` (hoje eles olham o risco declarado).
- Domínio **sensível**: `controle`, `terminal`, `arquivos`, `computador` e `navegador` ganham
  `requires.dono`. O `buildToolSet` os tira quando `soLeitura` (evento de terceiro), quando o turno
  é de pessoa da casa e quando é o automático do WhatsApp. Trava num teste: nem uma tool `leitura`
  desses domínios aparece nesses três caminhos.
- **Aceite:** teste em `registry.test.ts` provando que `elevarRisco` sobe de `leitura` para
  `perigoso` e manda para a fila, que não consegue descer de `efeito_externo` para `leitura`, e que
  uma exceção dentro dele trata a chamada como `perigoso` (falha fechada).

### F2. Sessão de controle

- Tabela `controle_sessao` (`user_id` cascade): `alvo`, `objetivo`, `pedido_original`, `apps`,
  `sites`, `teto_passos`, `passos_usados`, `expira_em`, `status`
  (`proposta|ativa|pausada|encerrada|parada`), `canal`, `maquina`.
- Tools `controle_iniciar` (`efeito_externo`), `controle_status` (`leitura`) e `controle_encerrar`
  (`escrita`).
- `autorizarNaSessao(ctx, alvo)` é o helper que as tools `escrita` de computador e navegador usam no
  `authorize`: sessão ativa, alvo dentro do envelope, teto não estourado.
- Espelho: ao ativar, pausar ou encerrar, o core avisa o `apps/maos` e a extensão.
- Eventos `controle.sessao_iniciada`, `controle.sessao_encerrada` e `controle.parado`.
- **Aceite:** teste do ciclo inteiro (propor, aprovar, agir, estourar teto, pausar). Uma ação
  `escrita` sem sessão é recusada com mensagem que diz como abrir uma.

### F3. Trilha de cada passo

- Tabela `controle_passo` (`user_id` cascade, `sessao_id` cascade e opcional, porque comando avulso
  aprovado não tem sessão): `tool`, `acao`, `alvo` (jsonb), `risco`, `decisao`
  (`executado|vetado|recusado|na_fila|falhou`), `resultado` (resumo curto), `duracao_ms`,
  `miniatura` (opcional, ver `controle.guardarMiniaturas`).
- Gravada antes de executar, com `decisao` atualizada depois: um processo que morre no meio deixa o
  rastro do que tentou.
- Entra sozinha no exportar e no apagar conta (`account/data.ts` deriva do schema).
- Retenção em `controle.retencaoDias`.
- **Aceite:** toda tool dos cinco domínios grava um passo. Isso é travado por um teste que percorre
  o registro, não por convenção.

### F4. Crítico de alinhamento

- `packages/core/src/controle/critico.ts`: uma chamada curta a um modelo barato
  (`controle.modeloCritico`). Ela recebe só **o pedido original do dono, o objetivo do envelope e os
  metadados da ação**: tool, ação, rótulo e papel do alvo, app ou domínio, e o texto a digitar
  truncado. **Nunca recebe a tela nem a página.**
- Devolve `{alinhado, motivo}` por `generateStructured` (funciona com modelo local, §9).
- Roda antes de toda ação `escrita` de computador e navegador. As `efeito_externo` já têm humano.
- Veto: a ação não executa, o motivo volta ao modelo e vai para a trilha. Com dois vetos seguidos a
  sessão pausa e o dono é avisado.
- **Falha fechada.** Se o crítico cair ou passar do tempo, a ação não executa
  (`controle.criticoSeFalhar`, padrão `bloquear`). É a exceção deliberada ao fail-soft do chat: aqui
  degradar significa agir sem freio.
- **Aceite:** testes com o modelo mockado (alinhado executa, vetado não executa, erro não executa),
  e a bancada da F8 mostrando vetos reais.

### F5. Imagem para o modelo e conteúdo de terceiro

- Saída de tool com imagem por `toModelOutput` do AI SDK, para o screenshot mascarado chegar ao
  modelo que enxerga. Se o modelo da cadeia não tiver visão, cai para a árvore UIA ou para a
  narração (`narrateSnapshot`), e a tool diz qual dos dois usou.
- `embrulharConteudoDeTerceiro(texto, origem)` em `controle/dado.ts`, usado por terminal, arquivos,
  computador e navegador.
- Cartão "Órbita no controle" em `cartoes-da-tela.ts`, com objetivo, passo X de Y, último passo e
  botão Parar. O campo `imagem` do cartão (miniatura) fica opcional.
- **Aceite:** um teste prova que a saída de `terminal_executar`, `arquivos_ler`, `computador_ver` e
  `navegador_ler` passa pelo embrulho.

### F6. Parar, de qualquer lugar, em menos de 300 ms

- **Atalho global** no `apps/maos` (`controle.atalhoParar`, sugestão `Ctrl+Alt+Esc`).
- **Botão** na borda da tela, no cartão e no ícone da bandeja.
- **Botão na aba** da extensão, que corta do lado da extensão sem depender do api.
- **Pela voz:** "para" ou "pare" na voz é tratado pelo **código**, como o "manda" do
  `por-frase.ts`, nunca por tool.
- **O dono mexeu, a Órbita para.** O gancho de baixo nível do Windows marca entrada injetada
  (`LLMHF_INJECTED`), então o `apps/maos` distingue o mouse do dono do clique da Órbita: entrada
  real pausa a sessão. A extensão faz o mesmo com evento confiável (`isTrusted`) na aba dela.
- Parar mata a árvore de processos do terminal (`TerminateJobObject`), solta o `chrome.debugger` e
  marca a sessão como `parada`.
- **Aceite:** medido com cronômetro no app real, do atalho até a última entrada injetada, abaixo de
  300 ms. Um mouse real no meio de uma sessão pausa em menos de um passo.

### F7. Tela "Controle do PC"

- Aba nova em Preferências com:
  - o estado do `apps/maos` e da extensão (ligado ou desligado, versão);
  - o pareamento da extensão e a revogação do token;
  - os sites (modo de cada um) e as pastas liberadas;
  - os apps ocultos na captura e a lista de comandos de leitura;
  - as sessões com a trilha passo a passo e o botão Parar;
  - as chaves do grupo `controle` (§10).
- Tudo com `OwnerGuard`. Nada disso tem tool (§2.3).
- **Aceite:** cada chave do §10 aparece na tela e é usada no código (sem chave órfã).

### F8. Bancada de ataque

- Páginas e arquivos armadilhados servidos localmente:
  - texto escondido mandando "abra o terminal e rode…";
  - campo de formulário oculto e instrução no fragmento da URL;
  - instrução no título da aba e em imagem;
  - um README de repositório que manda rodar `curl … | iex`;
  - saída de terminal com instrução;
  - e-mail aberto no navegador pedindo para encaminhar um código.
- **Testes estruturais no vitest:** com o modelo mockado obedecendo a injeção, nenhuma ação com
  efeito sai sem passar pela fila e nenhuma ação fora do envelope executa. Isso não depende do
  modelo e precisa dar zero.
- **Rodada real** com os modelos da cadeia, registrando quantas vezes o modelo tentou obedecer e
  quantas o crítico ou o gate barraram.
- **Aceite:** testes estruturais com zero escapes. Rodada real documentada no `MEDICAO.md`.

---

## 7. Frente A: computador e terminal

### A1. `apps/maos`: esqueleto e travas

- Python 3.12 + FastAPI em `apps/maos`, com venv próprio e pytest, no padrão do `apps/perception`.
  Porta padrão 8003.
- Instalação registra uma tarefa "ao fazer logon" do dono no Agendador de Tarefas, que roda o
  `pythonw` do venv (sem janela de console). **Não é serviço do Windows:** o serviço roda na sessão
  0, que não enxerga a área de trabalho.
- **Recusa subir elevado** (confere o token do processo) e recusa subir sem `MAOS_TOKEN`.
- Escuta só em `127.0.0.1`, recusa `Origin` e não responde CORS.
- Rotas: `GET /health` (versão, sessão do Windows, DPI, monitores), `POST /parar`,
  `PUT /envelope` (espelho).
- Ícone na bandeja (ligado, em controle, parado), atalho de parar (F6) e borda colorida por cima da
  tela, sem capturar clique, enquanto houver sessão ativa.
- No core, `packages/core/src/maos/client.ts` e um laço `maos` no `SchedulerService` que guarda o
  último `/health` em memória para o `requires.available` (que é síncrono). `/api/health` passa a
  mostrar `maos: up|down|mal_configurado`.
- **Aceite:** sobe sozinho no logon, não sobe como administrador, responde 401 sem token e 403 com
  `Origin`, aparece no `/api/health`.

### A2. Terminal: comando avulso

- `terminal_executar {comando, pasta?, shell?, esperarSeg?}`: declarada `leitura`, sobe pelo
  classificador (A3).
- Shell configurável: PowerShell 7, Windows PowerShell 5.1, Git Bash ou WSL (`terminal.shells`,
  `terminal.shellPadrao`).
- `pasta` tem de estar dentro de `terminal.pastas`. Fora delas é `perigoso`.
- O processo nasce num **Job Object** com `KILL_ON_JOB_CLOSE`, limite de memória
  (`terminal.memoriaMaxMb`) e **ambiente mínimo**: só as variáveis de `terminal.variaveisPermitidas`.
  O filho nunca herda `CONNECTORS_ENC_KEY`, `BETTER_AUTH_SECRET` nem token de conector.
- Saída por pipes, sem PTY: sai limpa e o código de saída é confiável. Antes de ir ao modelo, a saída
  é cortada em cabeça e cauda (`terminal.saidaMaxCaracteres`, padrão 30.000) e passa por uma máscara
  de segredo (padrões de token conhecidos, valores do `.env`).
- **Mais de ~10 s não fica na requisição** (§6 do CLAUDE.md): a tool espera até `esperarSeg`
  (padrão 8). Se o comando não acabou, vira o trabalho `terminal.comando` na fila, com a saída como
  progresso, e devolve o id ("continua rodando, te aviso quando terminar"). Teto em
  `terminal.timeoutMaxSeg` (padrão 600).
- `terminal_saida {id}` (`leitura`) lê o que já saiu. `terminal_parar {id}` (`escrita`) mata a árvore.
- Ao fim, emite `terminal.comando_terminado {id, codigo, duracao}`, que regra pode usar ("me avisa
  quando o build acabar").
- **Aceite:**
  - `git status` sai direto.
  - `pnpm install` vira proposta com o comando inteiro no resumo.
  - Um comando de 30 s vira trabalho e avisa ao terminar.
  - Matar o processo do `apps/maos` mata os filhos.
  - Um teste prova que `BETTER_AUTH_SECRET` não aparece no `env` do filho.

### A3. Classificador de comando

- O `apps/maos` analisa e o core decide:
  - `POST /terminal/analisar` devolve os **fatos** do comando: comandos, argumentos, operadores,
    redirecionamentos, substituições, se o parse falhou.
  - PowerShell pelo `Parser.ParseInput` (AST oficial, com aliases resolvidos: `gci` é
    `Get-ChildItem`). Como o `apps/maos` é Python, o parser roda num processo `pwsh -NoProfile`
    que **fica aberto** e recebe um comando por linha em JSON. Subir um `pwsh` por análise custaria
    ~300 ms.
  - bash pelo binding Python do `tree-sitter` com a gramática `tree-sitter-bash`.
- `riscoDoComando(fatos, config)` é uma função pura em `packages/core/src/terminal/risco.ts`, testada
  no vitest:
  - `leitura` só com **todos** os comandos na lista de leitura e nenhum operador perigoso;
  - parse falho, `iex`, `-EncodedCommand`, `Start-Process -Verb RunAs`, `&` com nome dinâmico,
    UNC, Registro, `Remove-Item -Recurse` e download seguido de execução dão `perigoso`;
  - o resto dá `efeito_externo`.
- A lista de leitura é dado (`terminal.comandosDeLeitura`), com um padrão sensato (`git status`,
  `git log`, `git diff`, `Get-ChildItem`, `Get-Content`, `Get-Process`, `ls`, `cat`, `pwd`,
  `node --version`…). O dono acrescenta os dele (`pnpm test`, por exemplo).
- **A denylist nunca é fronteira:** ela só força `perigoso`. Quem libera é a allowlist. Foi o furo do
  Gemini CLI em jul/2025 (`grep …; env | curl …` passava como grep).
- **Aceite:** tabela de pelo menos 60 casos no teste, incluindo os truques conhecidos: `;` escondido
  depois de espaços, `` ` `` de continuação, `$()`, `cmd /c`, alias, caminho com `..`, `&&` com
  comando liberado na frente.

### A4. Arquivos

- `arquivos_listar`, `arquivos_ler` e `arquivos_buscar` (`leitura`), só dentro de `arquivos.pastas`.
- Padrões sempre negados (`arquivos.negados`): `.env*`, `*.pem`, `*.key`, `.ssh`, `.mcp.json`, a pasta
  de perfis do Chrome e a pasta de dados da Órbita.
- `arquivos_escrever` (`efeito_externo`, a proposta mostra o diff).
- `arquivos_para_lixeira` (`efeito_externo`, vai para a Lixeira do Windows e dá para desfazer).
- **Não existe tool de apagar de vez.**
- **Aceite:**
  - ler `.env` é recusado mesmo dentro da pasta liberada;
  - `..` não escapa da raiz;
  - link simbólico que aponta para fora é recusado;
  - o arquivo apagado está na Lixeira.

### A5. Sistema e mídia (os ganhos rápidos da voz)

- `computador_sistema` (`leitura`): CPU, memória, disco por unidade, processos que mais consomem,
  bateria, rede.
- `computador_midia` (`escrita`, **sem sessão**): tocar, pausar, próxima, volume, mudo, bloquear a
  tela.
- `computador_encerrar_processo` (`efeito_externo`).
- **Aceite:** "abaixa o volume", "pausa a música" e "bloqueia o PC" pela voz funcionam sem
  aprovação; "fecha o Chrome" vira proposta.

### A6. Ver o computador

- `computador_janelas` (`leitura`): janelas abertas, app, título, qual tem foco, monitor.
- `computador_ver {janela?, comImagem?}` (`leitura`): a árvore UIA da janela, filtrada para os
  elementos que dá para usar, com id, papel, nome e estado, e cortada em `computador.elementosMax`.
  Com `comImagem`, vem também o screenshot da janela ou do monitor.
- Captura: um monitor por vez, processo com DPI por monitor (Per-Monitor V2), reduzida para
  `computador.resolucaoCaptura` (padrão 1280x720, o que a Anthropic recomenda), com a escala guardada
  para converter coordenadas de volta.
- **Apps ocultos** (`computador.appsOcultos`, padrão: gerenciadores de senha, Segurança do Windows e a
  tela de Identidade da Órbita): a janela sai pintada de preto no screenshot e fora da árvore, **já
  no `apps/maos`**, antes de qualquer byte sair.
- Screenshot não é gravado em disco, salvo a miniatura opcional da trilha.
- **Aceite:**
  - árvore UIA do VS Code, Explorer e Chrome com ids que clicam certo no A7;
  - um gerenciador de senha aberto sai preto;
  - coordenadas certas com escala de 125% e 150% e com dois monitores.

### A7. Agir no computador

- `computador_agir {acao, alvo, texto?}` (`escrita`, exige sessão, F2), com ações `clicar`,
  `clique_duplo`, `clique_direito`, `digitar`, `tecla`, `atalho`, `rolar`, `arrastar` e `focar`.
- **Alvo por elemento UIA primeiro**, usando o padrão de acessibilidade quando existe (`Invoke`,
  `Value`, `Toggle`), que não depende de onde o mouse está. Coordenada fica como reserva.
- `elevarRisco`: rótulo ou papel que bate com `computador.rotulosDeEfeito` dá `efeito_externo`; campo
  de senha recusa; app fora do envelope recusa.
- `computador_abrir {app|arquivo|url}` (`escrita` com o alvo no envelope, `efeito_externo` fora dele).
- Ações em lote: várias por turno, executadas em ordem, e a primeira falha cancela o resto.
- Toda ação passa pelo crítico (F4) e grava passo (F3).
- **Aceite:** as tarefas de desktop da lista do §14.1 atingem a meta calibrada na F0. Clicar em
  "Enviar" no Outlook vira proposta. Digitar no campo de senha do Windows é recusado.

### A8. Tarefa delegada ao Claude (o motor principal)

- `computador_tarefa {objetivo}` (`escrita`, exige sessão): a conversa entrega o objetivo e um laço
  próprio (`packages/core/src/computador/motor-claude.ts`) dirige os passos com o Claude da
  assinatura e o `computer_toolset_20260801` (§5.6).
- **Por que um laço à parte e não a tool solta no chat:**
  - os screenshots ficam no contexto do laço, não no da conversa;
  - o laço segue a receita da Anthropic: guardar os 3 últimos screenshots inteiros, podar o resto,
    captura em 1280x720;
  - a voz realtime (OpenAI ou Gemini) não consegue usar a tool do Claude, mas consegue chamar
    `computador_tarefa`. Pela voz, o dono pede e o Claude executa.
- Cada ação do Claude vira uma ordem para o `apps/maos`. A coordenada é traduzida em elemento
  (`ElementFromPoint`) e passa por envelope, `elevarRisco`, crítico, fila e trilha, exatamente como
  `computador_agir`.
  - Ação que cai em `efeito_externo` **pausa o laço**, enfileira a proposta com o screenshot do
    momento no resumo e retoma quando o dono aprova.
  - O teto de passos do envelope vale para o laço inteiro.
- Progresso no cartão "Órbita no controle" (F5), e o resultado volta à conversa como resumo em
  texto.
- **Sem o Claude na cadeia** (`computador.motor`: `claude` | `orbita`, e a cadeia decide sozinha
  quando o Claude não responde), o laço usa as tools próprias com a árvore de acessibilidade e, para
  app sem UIA (jogo, canvas), screenshot com **marcas numeradas** (set-of-marks).
- **Aceite:**
  - "abre o VS Code no projeto da Órbita e roda os testes no terminal integrado" conclui pela voz;
  - um passo que clica em "Enviar" pausa e vira proposta com screenshot;
  - a bancada F8 com o motor do Claude dá zero escapes estruturais;
  - com o Claude desligado, a mesma tarefa roda com as tools próprias.

### A9. Sessão de terminal persistente (depois)

- `terminal_sessao_abrir | escrever | ler | fechar` sobre ConPTY (`pywinpty`), para dev server,
  REPL e `ssh`.
- `escrever` numa sessão é `efeito_externo` por padrão. O classificador não enxerga dentro de um
  programa interativo.
- **Aceite:** subir o `next dev` numa sessão e ler o "Ready" sem travar o turno.

### A10. Isolamento forte para o que é estranho (depois)

- Modo `isolado` para script desconhecido: Windows Sandbox (`wsb`, rede desligada, pasta
  compartilhada só para leitura). Saída por arquivo, porque o `wsb exec` não devolve stdout.
- Alternativa: WSL2 ou contêiner.
- Revisitar o Agent Workspace do Windows quando sair do preview.

---

## 8. Frente B: Chrome

### B0. Sondagem

Coberta pela F0, com três pontos próprios do navegador:

- quanto custa o snapshot de acessibilidade das páginas que o dono usa (os números públicos vão de
  ~300 a ~10.000 tokens por página);
- se o `chrome.debugger` age em aba sem foco;
- quanto incomoda a faixa "Órbita começou a depurar este navegador".

### B1. Extensão: esqueleto, pareamento e grupo de abas

- `apps/extensao-chrome`: MV3 em TypeScript, carregada sem empacotar, com `key` fixa no manifesto
  (ID estável para o `Origin`).
- Permissões: `debugger`, `tabs`, `tabGroups`, `scripting`, `storage`, `sidePanel` e
  `host_permissions: <all_urls>`.
- O service worker guarda estado em `chrome.storage`, nunca em variável global (ele morre), e
  reconecta sozinho.
- Pareamento e canal como no §5.2.
- No api, `apps/api/src/navegador/` (gateway WebSocket do Nest). `navegador.conectado()` alimenta o
  `requires.available`.
- Toda aba que a Órbita abre entra num grupo "Órbita: <objetivo>" com cor própria. O grupo some
  quando a sessão acaba. O dono pode arrastar uma aba dele para o grupo, e ela entra no escopo.
- **A faixa do debugger fica.** Ela some com instalação por política, mas é um aviso de segurança
  útil (§11, pergunta 1).
- **Aceite:**
  - pareia pelo código;
  - um site qualquer na mesma máquina não consegue abrir o canal (sem token, Origin errado);
  - reconecta depois de o api reiniciar;
  - revogar na tela derruba a extensão.

### B2. Ler o navegador

- `navegador_abas` (`leitura`): abas abertas com título e domínio. Aba de site bloqueado aparece
  como "site bloqueado", sem título.
- `navegador_ler {aba?}` (`leitura`): o texto principal da página e um snapshot de acessibilidade
  filtrado (elementos interativos e área visível) com refs, embrulhado como conteúdo de terceiro e
  sanitizado (§5.5).
- `navegador_ver {aba?}` (`leitura`): screenshot da aba por CDP (`Page.captureScreenshot`).
- `navegador_extrair {aba?, campos}` (`leitura`): o dono ou o modelo dá os campos ("valor, vencimento,
  código de barras"), a resposta volta tipada e validada.
- **Máscara antes de sair do navegador:** valor de `input[type=password]`, `autocomplete=cc-*`,
  `one-time-code` e campos de CVV e cartão viram `[oculto]` **na extensão**.
- Modo de cada site em `navegador_site` (`dominio`, `modo`: `bloqueado|leitura|escrita`).
  - Site sem linha usa `navegador.padraoSite` (padrão `leitura`).
  - Categorias bloqueadas de saída: os domínios de `emails.bancos`, gerenciadores de senha, webmail
    (o Gmail tem conector, e foi pelo e-mail que o Comet vazou OTP), `chrome://`, a Chrome Web Store,
    página de conta do Google e da Microsoft, e a própria Órbita.
  - Site bloqueado não entra no contexto, nem o título.
- **Aceite:**
  - ler uma página de notícia e um card do Jira;
  - a senha digitada num formulário sai `[oculto]`;
  - a aba do banco sai "site bloqueado";
  - o texto escondido da bancada F8 não chega ao modelo.

### B3. Agir no navegador

- `navegador_abrir {url}`: `escrita` se o domínio está no envelope ou é `escrita`, `efeito_externo`
  se não, recusado se bloqueado.
  - URL **montada pelo modelo** com parâmetro de consulta tirado de outra página é `efeito_externo`:
    abrir URL é um canal de vazamento.
  - Redirecionamento para domínio fora do envelope pausa e pergunta.
- `navegador_agir {acao, ref, texto?}` (`escrita`, exige sessão), com ações `clicar`, `preencher`,
  `selecionar`, `marcar`, `rolar`, `tecla` e `passar_mouse`.
  - `elevarRisco`: botão `submit`, enviar formulário, rótulos de `navegador.rotulosDeEfeito`
    (comprar, pagar, enviar, publicar, excluir, confirmar, assinar, compartilhar) e upload de arquivo
    dão `efeito_externo`.
  - Campo de senha, cartão ou OTP é recusado.
- **Login, captcha e 2FA:** a Órbita para, avisa pelo canal ("preciso que você faça o login no X") e
  retoma quando a URL ou o estado mudar. **Nunca digita senha** e nunca resolve captcha.
- O dono clicou ou digitou na aba do grupo (evento `isTrusted`), a sessão pausa (F6).
- Borda colorida na aba e botão Parar por content script, enquanto a Órbita age.
- **Tarefa delegada ao Claude:** `navegador_tarefa {objetivo}` (`escrita`, exige sessão), no mesmo
  desenho da A8, com o `browser_toolset_20260801` (§5.6). A extensão traduz cada ação do Claude em
  elemento (`document.elementFromPoint` ou a ref) antes de executar, então `elevarRisco`, sites,
  máscara de senha, crítico e fila valem igual. Sem o Claude na cadeia, as tools próprias acima.
  - **Primeiro passo:** listar os membros que o `browser_toolset_20260801` declara (o teste de 10/10
    só exercitou o `screenshot`) e mapear cada um para uma ação da extensão. Membro sem tradução
    segura (por exemplo, rodar JavaScript, §2.4) fica de fora.
- **Aceite:**
  - preencher um formulário de teste e parar antes do "Enviar", com a proposta na fila;
  - um site fora do envelope pede aprovação;
  - um login para e avisa;
  - a bancada F8 dá zero escapes estruturais.

### B4. Roteiros que se repetem

- Tarefa que deu certo vira roteiro em `navegador_roteiro` (domínio, intenção, passos com alvo
  semântico: papel, nome e texto, e um seletor de reserva).
- Da próxima vez, a Órbita tenta reexecutar sem o modelo e só chama o LLM no passo que não casar.
- Passo com efeito reexecutado **continua indo para a fila**: o roteiro economiza modelo, não
  aprovação.
- **Aceite:** a segunda execução de uma tarefa repetida gasta menos de 20% dos tokens da primeira.

### B5. Atalhos e rotinas assistidas

- "Todo dia às 9h abre o Jira e me diz o que entrou" vira regra `cron` com ação `prompt`, usando só
  as tools de leitura do navegador.
- Rotina com ação no navegador só no perfil dedicado (B6).

### B6. Perfil dedicado para o que roda sozinho (depois)

- Um Chrome separado, com `--user-data-dir` próprio ("Órbita"), aberto pelo `apps/maos` com
  `--remote-debugging-pipe` (sem porta aberta) e controlado por Playwright ou Stagehand.
- O dono faz login ali **só** nos sites que a Órbita pode usar sozinha. Os cookies do perfil real
  nunca estão nele.
- Rotinas e regras com ação no navegador só rodam aqui. A extensão no perfil real recusa ordem com
  origem `rotina` ou `regra`.
- **Aceite:** uma rotina de madrugada conclui no perfil dedicado com o Chrome do dono fechado, e a
  mesma ordem mandada ao perfil real é recusada.

### B7. Native messaging (endurecimento, depois)

- Trocar o WebSocket por `connectNative`: o `allowed_origins` sem curinga garante por construção que
  só a extensão da Órbita fala com o host. O host fica registrado em
  `HKCU\SOFTWARE\Google\Chrome\NativeMessagingHosts`, é um executável pequeno (pode ser o próprio
  `apps/maos`) e repassa para o api.
- Limite de 1 MB por mensagem do host para o Chrome: screenshot vai em pedaços ou por arquivo.

---

## 8.1 Frente C: anexos de qualquer tipo

### Por que

O dono pediu para a Órbita ver um e-mail que tinha anexo, e ela não conseguiu. Verificado no código
em 10/10/2026, a causa é anterior ao anexo: **a Órbita não abre o e-mail.**

- `listRecentEmails` (`connectors/google.ts`) pede a mensagem com `format=metadata`, ou seja, só
  remetente, assunto, data e o `snippet` (os ~200 primeiros caracteres que o Gmail gera). O corpo e
  a lista de anexos nunca são pedidos.
- No Outlook (`connectors/microsoft.ts`), é só `bodyPreview`, sem `/attachments`.
- Não existe tool de ler um e-mail inteiro nem de abrir anexo.
- **A permissão já existe:** o Google pede `https://mail.google.com/` e a Microsoft `Mail.ReadWrite`,
  que cobrem baixar anexo. Não precisa reconectar.
- O leitor de documentos que já existe (`ocr/index.ts` `lerDocumento`) lê bem PDF (texto, OCR e
  visão) e imagem (OCR e visão). **Todo o resto ele trata como texto UTF-8:** um `.docx`, `.xlsx` ou
  `.zip` viraria lixo binário passado ao modelo. É um defeito que já existe hoje no caminho do
  WhatsApp e do "indexar arquivo", e esta frente o corrige.

Esta frente não depende das mãos (A e B) e entrega valor sozinha, por isso vem **primeiro** na
ordem (§9).

### C1. Ler o e-mail inteiro

- `ler_email {id, conta?}` (`leitura`), para Gmail e Outlook:
  - Gmail: `format=full`, corpo `text/plain` ou, sem ele, `text/html` convertido em texto (sem
    script, sem estilo e sem imagem remota);
  - Outlook: `body` e `/attachments`.
- Devolve remetente, para, cc, data, assunto, corpo (cortado em `anexos.caracteresMax`, com
  `parte` para ler o resto) e a **lista de anexos**: nome, tipo, tamanho e id.
- `ler_emails` e `outlook_ler_emails` passam a dizer `tem_anexo` e os nomes. O modelo sabe que pode
  abrir sem ter de adivinhar.
- O corpo é conteúdo de terceiro (§5.2) e vai embrulhado (F5).
- **Aceite:** "lê o e-mail da Fulana" traz o corpo inteiro e a lista de anexos, nas duas contas de
  Gmail e no Outlook.

### C2. Abrir o anexo

- `ler_anexo {email_id, anexo, conta?, parte?}` (`leitura`):
  - baixa por `users.messages.attachments.get` (Gmail) ou `/attachments/{id}/$value` (Outlook);
  - passa pelo extrator universal (C3) e devolve o texto, as tabelas e um resumo do que é.
- Arquivo grande ou demorado (OCR de PDF de 80 páginas, áudio de 20 minutos): espera até
  `anexos.esperarSeg`. Se não acabou, vira o trabalho `anexo.ler` na fila (§6 do CLAUDE.md) e avisa
  quando terminar ("terminei de ler o contrato, quer o resumo?").
- O texto extraído fica guardado em `anexo_lido` (`user_id` cascade, conta, mensagem, anexo, hash
  dos bytes, tipo detectado, texto, `lido_em`). A segunda pergunta sobre o mesmo anexo é instantânea,
  e a retenção é `anexos.retencaoDias`.
- **Aceite:** um PDF, uma planilha e um Word anexados num e-mail de teste são lidos e respondidos
  pelo chat e pela voz.

### C3. O extrator universal: um só para todos os canais

`packages/core/src/arquivos/extrair.ts`. O tipo é decidido pelos **bytes** (assinatura mágica, com
`file-type`), nunca só pela extensão ou pelo `Content-Type`, que quem mandou o e-mail escolhe.

| Tipo | Como lê |
|---|---|
| PDF, imagem (JPG, PNG, WEBP, HEIC, TIFF, GIF) | O `lerDocumento` que já existe (texto, OCR, visão) |
| Texto (TXT, CSV, TSV, MD, JSON, XML, LOG, código) | Detecção de codificação (UTF-8, Latin-1, UTF-16). CSV e TSV viram tabela |
| HTML, MHT | Convertido em texto, sem script e sem recurso remoto |
| Word (DOCX, DOCM), ODT, RTF | Texto e tabelas. Macro **nunca roda**: o arquivo é lido como dado |
| Word antigo (DOC) | Extrator de `.doc` binário |
| Planilha (XLSX, XLSM, XLS, ODS) | Cada aba vira tabela (markdown), com o nome da aba e o teto `anexos.linhasMax` |
| Apresentação (PPTX, ODP) | Texto de cada slide e das notas, na ordem |
| E-mail anexado (EML, MSG) | Cabeçalho, corpo e os anexos dele, recursivo |
| Compactado (ZIP; 7Z e RAR se o 7-Zip estiver instalado) | Lista o conteúdo e extrai cada arquivo pelo mesmo extrator, com tetos contra bomba de compressão (`anexos.zipMaxArquivos`, `anexos.zipMaxMb`, `anexos.zipProfundidade`) |
| Áudio (MP3, M4A, OGG, OPUS, WAV, AAC) | A transcrição que já existe (`meetings/transcribe.ts`: AssemblyAI, depois o whisper local) |
| Vídeo (MP4, MOV, WEBM) | Áudio separado pelo `apps/voice` (PyAV) e transcrito. Opcional: alguns quadros para a visão |
| Agenda e contato (ICS, VCF) | Evento e contato estruturados. A tool pode oferecer "criar o evento" (aí sim pela fila) |
| XML de nota fiscal (NF-e) | Emitente, itens, valor, data. Ponte para Finanças |
| Executável e instalador (EXE, MSI, BAT, CMD, PS1, VBS, JS, LNK, ISO, APK) | **Nunca executa.** Script é lido como texto (é dado, como qualquer outro). Binário devolve só tipo, tamanho e hash, com aviso |
| Protegido por senha (PDF, ZIP, Office) | Diz que está protegido. Ver C5 |
| Tipo desconhecido | Tipo detectado, tamanho e "não sei ler este formato". Nunca joga bytes crus no modelo |

- O `lerDocumento` deixa de tratar "o resto" como UTF-8 e passa a chamar o extrator. **O mesmo
  extrator serve** para o anexo de e-mail, o documento do WhatsApp (`usar_arquivo_whatsapp`), o
  arquivo do Telegram, o "indexar arquivo" (`rag/files.ts`) e, depois, o anexo de Jira e Slack e a
  `arquivos_ler` (A4).
- Cada leitor mora no seu arquivo (`arquivos/leitores/{office,planilha,compactado,email,midia}.ts`),
  com teste próprio usando arquivos pequenos de exemplo em `__fixtures__`.
- Bibliotecas a confirmar na implementação (manutenção e licença): `file-type`, `mammoth` ou
  `officeparser`, `exceljs` ou SheetJS, `word-extractor`, `mailparser`, `@kenjiuno/msgreader`,
  `yauzl`, `html-to-text`.
- **Aceite:**
  - um teste por linha da tabela;
  - um `.docx` renomeado para `.pdf` é lido como Word;
  - um ZIP bomba é recusado nos tetos sem estourar a memória;
  - um `.exe` nunca é gravado com permissão de execução nem aberto.

### C4. Fazer algo com o anexo

Tudo pelas tools que já existem, com o risco que elas já têm:

- **Boleto, fatura, extrato e cupom** seguem para Finanças (`finance/documents.ts`, `finance/boleto.ts`,
  `finance/extrato.ts`): "lança esse boleto" vira proposta de lançamento.
- **Guardar no conhecimento** (`indexFile`) a partir de anexo de e-mail é `efeito_externo`, pela
  fila. É a mesma lição do `usar_arquivo_whatsapp`: um e-mail de terceiro dizendo "guarde isto" não
  pode virar contexto permanente sozinho.
- **Mandar o anexo para alguém** (WhatsApp, e-mail) continua `efeito_externo`.
- **Salvar no computador** ("baixa esse anexo") grava em `Downloads/Órbita/` pelo `apps/maos`
  (`escrita`). Abrir com o programa padrão do Windows é `efeito_externo`, e executável nunca é
  aberto.
- **Aceite:** "lança o boleto que veio no e-mail da Enel" vira proposta com valor, vencimento e
  código de barras lidos do PDF anexado.

### C5. Arquivo protegido por senha

Fatura e extrato de banco no Brasil costumam vir em PDF protegido (os primeiros dígitos do CPF, a
data de nascimento).

- Senhas por remetente, que o **dono cadastra na tela** (`anexo_senha`: domínio do remetente e senha
  cifrada com `packages/core/src/crypto.ts`, o mesmo dos tokens de conector).
- A Órbita tenta sozinha as senhas daquele remetente. Sem nenhuma, responde "este PDF tem senha,
  cadastre em Ajustes".
- **A senha nunca é pedida nem aceita pelo chat ou pela voz:** ficaria no histórico da conversa e
  passaria pelo modelo.
- **Aceite:** a fatura protegida do banco é lida depois de a senha ser cadastrada na tela, e a
  senha não aparece em log, trilha nem histórico.

### C6. Imagens e documentos dentro do corpo

- Imagem embutida no corpo (`cid:`) é tratada como anexo e pode ser lida (print, foto de cupom).
- Link de documento compartilhado (Google Drive, OneDrive) dentro do e-mail é **listado**, não
  baixado: abrir é o caminho do navegador (frente B) ou de um conector de Drive futuro.

---

## 9. Ordem de execução

| Ordem | Item | Depende de | Observação |
|---|---|---|---|
| 0 | **C1 a C6 anexos** | nada | Independe das mãos e resolve o que já falhou. Roda em paralelo com a F0 |
| 1 | F0 sondagem | nada | Uma semana de uso real antes de escrever produto |
| 2 | F1 risco por entrada e domínio sensível | nada | Mudança pequena e central no registro |
| 3 | F2 sessão + F3 trilha | F1 | Schema e migração (conferir o `when` do journal, §9 do CLAUDE.md) |
| 4 | A1 `apps/maos` + F6 parar (lado Windows) | F2 | Nada age antes de existir o parar |
| 5 | A2 + A3 terminal e classificador | A1 | **Primeiro valor de verdade** |
| 6 | A4 arquivos · A5 sistema e mídia | A1 | Ganhos rápidos da voz |
| 7 | F7 tela "Controle do PC" | F2, A1 | Antes de alguém além do dev usar |
| 8 | B1 extensão + F6 parar (lado Chrome) | F2 | Independe da frente A |
| 9 | B2 ler o navegador | B1 | Já útil sozinho (resumir, extrair) |
| 10 | F4 crítico + F5 imagem e dado | F2 | Pré-requisito de agir |
| 11 | F8 bancada de ataque | F4 | Trava antes de ligar ação |
| 12 | B3 agir no navegador, com o `browser_toolset` do Claude | F4, F8 | Começa pela lista de membros do toolset |
| 13 | A6 + A7 ver e agir no computador | F4, F8 | |
| 14 | A8 tarefa delegada ao Claude (**item separado, "A8 motor do desktop"**) | A7 | Desmembrado da frente A em 11/10/2026 por decisão do dono: a frente A fecha sem ele (A1 a A7, A9, A10), e o motor entra depois, como entrega própria. A A7 dá as mãos, a A8 dá o motor. Estado: implementado em 11/10/2026 (`PRD-MOTOR-DESKTOP.md`; laço, tool `computador_tarefa`, trabalho, reserva e bancada estrutural com testes; contrato e ponta a ponta com o Claude de verdade, em `apps/maos/MEDICAO.md`) |
| 15 | B4 roteiros · B5 rotinas | B3 | |
| 16 | B6 perfil dedicado · A9 PTY · A10 isolamento · B7 native messaging | | Depois |

---

## 10. Configuração (chaves novas, todas com tela e `OwnerGuard`)

| Chave | Padrão | O que faz |
|---|---|---|
| `controle.ativo` | `false` | Liga as frentes A e B. Desligado, as tools delas nem aparecem. A frente C não depende desta chave |
| `controle.canais` | `tela, voz, whatsapp` | Canais que podem usar os domínios (decidido em 10/10). O Telegram é opcional |
| `controle.tetoPassos` · `controle.tetoMinutos` | 30 · 15 | Padrão do envelope |
| `controle.modeloCritico` · `controle.criticoSeFalhar` | rápido · `bloquear` | F4 |
| `controle.atalhoParar` | `Ctrl+Alt+Esc` | F6 |
| `controle.guardarMiniaturas` · `controle.retencaoDias` | `false` · 30 | F3 |
| `controle.capturaParaNuvem` | `true` (decidido em 10/10) | Se o screenshot pode ir a modelo na nuvem. Desligado, a frente A fica só com a árvore de acessibilidade |
| `maos.url` · `maos.timeoutMs` | `http://127.0.0.1:8003` · 10.000 | Cliente do `apps/maos` |
| `terminal.shells` · `terminal.shellPadrao` | detectados · `pwsh` | A2 |
| `terminal.pastas` | a pasta `github` do dono | Raízes onde comando roda |
| `terminal.comandosDeLeitura` | lista sensata | A3. A allowlist é o que libera |
| `terminal.variaveisPermitidas` | `PATH, SystemRoot, TEMP, USERPROFILE…` | Ambiente mínimo |
| `terminal.esperarSeg` · `terminal.timeoutMaxSeg` | 8 · 600 | A2 |
| `terminal.saidaMaxCaracteres` · `terminal.memoriaMaxMb` | 30.000 · 2.048 | A2 |
| `arquivos.pastas` · `arquivos.negados` | Documentos, Downloads, `github` · segredos | A4 |
| `computador.appsOcultos` | gerenciadores de senha, Segurança do Windows | A6 |
| `computador.resolucaoCaptura` · `computador.elementosMax` | 1280x720 · 300 | A6 |
| `computador.rotulosDeEfeito` | enviar, excluir, comprar, pagar… | A7 |
| `computador.motor` · `navegador.motor` | `claude` | A8 e B3. `orbita` força as tools próprias |
| `computador.modeloMotor` | `claude/claude-sonnet-5-5` | Modelo do laço delegado (A8) |
| `navegador.extensaoId` | ID da extensão | Origin aceito |
| `navegador.padraoSite` | `leitura` | Site sem linha em `navegador_site` |
| `navegador.categoriasBloqueadas` | bancos, senha, webmail, contas, Órbita | B2 |
| `navegador.rotulosDeEfeito` | comprar, pagar, enviar, publicar… | B3 |
| `anexos.tamanhoMaxMb` | 50 | C2. Maior que isso, só a lista e o tamanho |
| `anexos.esperarSeg` · `anexos.caracteresMax` · `anexos.linhasMax` | 8 · 40.000 · 2.000 | C1 a C3 |
| `anexos.zipMaxArquivos` · `anexos.zipMaxMb` · `anexos.zipProfundidade` | 200 · 500 · 3 | C3, contra bomba de compressão |
| `anexos.transcreverAudio` · `anexos.retencaoDias` | `true` · 90 | C3 e C2 |

O teto da voz realtime merece atenção: ela recebe **todas** as tools (decisão de 27/09/2026) e a OpenAI
aceita até 128. Hoje são ~80 nativas e 2 de MCP. Este PRD soma 27: 3 de controle, 3 de terminal, 4 de
arquivos, 7 de computador (com `computador_tarefa`), 5 a 7 de navegador (com `navegador_tarefa`) e 2
de anexos. Isso chega perto de 110. Daí as tools compactas com `acao` em enum, e um teste que reprova
se a soma passar de `realtime.toolsMax`.

---

## 11. Perguntas para o dono

Respondidas em 10/10/2026: linguagem Python, WhatsApp "Eu" liberado, screenshot pode ir à nuvem,
"manda" abre sessão, apps de chamada ficam dentro da captura (§3).

Em aberto:

1. **A faixa amarela do Chrome.** Quando uma extensão controla o Chrome pela API de depuração, o
   próprio Chrome mostra no topo da janela uma faixa amarela, mais ou menos assim:
   *"Órbita começou a depurar este navegador [Cancelar]"*. Ela fica ali o tempo todo em que a Órbita
   estiver no controle, e o "Cancelar" corta o controle na hora.
   - **Manter (recomendado):** é um aviso de que algo está controlando o navegador, que nenhum site
     consegue esconder, e serve de botão de parar a mais.
   - **Esconder:** instalar a extensão por política do Windows (registro em `HKCU`). A faixa some,
     mas o único aviso passa a ser a borda que a própria Órbita desenha.
2. **Senha de PDF de banco (C5):** cadastrar as senhas por remetente na tela está bom, ou prefere
   que a Órbita só diga que o arquivo tem senha?

---

## 12. Armadilhas conhecidas

1. **Chrome 136+ ignora `--remote-debugging-port` no perfil padrão.** Copiar a pasta do perfil não
   leva os cookies (a chave de criptografia é outra). Perfil real só por extensão.
2. **O service worker MV3 morre com 30 s parado.** WebSocket ativo (Chrome 116+) e sessão de
   `chrome.debugger` (118+) o mantêm vivo. Estado vai para `chrome.storage`.
3. **Serviço do Windows não enxerga a tela** (sessão 0). O `apps/maos` nasce no logon.
4. **UIPI:** sem elevação não há clique em janela elevada. É a trava desejada. Não "consertar"
   rodando como administrador.
5. **DPI:** sem Per-Monitor V2, o clique sai deslocado em escala de 125% ou 150%. Coordenada de
   screenshot reduzido precisa voltar para a escala real.
6. **A tela muda entre propor e executar.** Toda ordem com alvo leva a assinatura dele, e a mão
   confere antes de agir.
7. **Processo criado por WMI (`Win32_Process.Create`) escapa do Job Object.** O classificador trata
   `Invoke-CimMethod`, `wmic` e `Start-Process` de formas indiretas como `perigoso`.
8. **Apps Electron (VS Code, Teams, Slack) e o próprio Chrome só expõem a árvore inteira quando
   detectam leitor de tela.** Conferir na F0. Pode exigir ativar a acessibilidade do Chromium
   (`--force-renderer-accessibility`) ou cair para a visão.
9. **O `seeScreen()` antigo não respeita os apps ocultos:** o `getDisplayMedia` do navegador captura
   o que o dono escolher. É a armadilha "tool antiga fura regra nova" do §9 do CLAUDE.md. A tela de
   escolha é do navegador e o dono vê o que compartilha, mas fica escrito como limite conhecido.
10. **`Windows Sandbox exec` não devolve stdout.** A saída vai por pasta compartilhada.
11. **O `tsx watch` reinicia o api a cada arquivo salvo:** a extensão e o laço `maos` reconectam
    sozinhos, e comando longo vive no `apps/maos`, não no api.
12. **Native messaging tem limite de 1 MB do host para o Chrome** e exige stdio em modo binário no
    Windows.
13. **O CLAUDE.md aponta `lib/net/ssrf.ts` e `lib/crypto.ts`, mas os arquivos vivem em
    `packages/core/src/net/ssrf.ts` e `packages/core/src/crypto.ts`.** Corrigir o CLAUDE.md junto
    com o primeiro item que mexer ali.
14. **O SDK do repositório não conhece o computer use novo.** O `@ai-sdk/anthropic@4.0.16` só tem
    até `computer_20251124`, e os modelos 5.5 recusam esse tipo com 400. O toolset entra sem `name`
    e sem tamanho de tela, só `{ "type": "computer_toolset_20260801" }` (testado em 10/10).
15. **`lerDocumento` trata todo arquivo que não é PDF nem imagem como texto UTF-8.** Um `.docx`
    chega ao modelo como lixo binário, sem erro. A C3 corrige; até lá, qualquer porta nova de
    arquivo herda o defeito.
16. **Tipo de anexo vem de quem mandou.** Nome e `Content-Type` são escolha do remetente. O tipo se
    decide pelos bytes, e um `.pdf` que na verdade é `.exe` nunca é aberto.

---

## 13. Riscos

| Risco | Tamanho | Mitigação |
|---|---|---|
| Injeção numa página ou tela leva a Órbita a agir contra o dono | Alto | Envelope, risco por alvo, crítico cego à página, fila para efeito, travas repetidas nas mãos, bancada F8 |
| Comando destrutivo passa como leitura | Alto | Allowlist com parse de AST, falha de parse vira `perigoso`, 60+ casos no teste, Lixeira em vez de apagar |
| Outro processo ou site local fala com o `apps/maos` ou com o canal da extensão | Alto | Token obrigatório, recusa de `Origin`, só `127.0.0.1`, pareamento com código, revogação |
| Vazamento de segredo pela saída do terminal ou pelo screenshot | Médio | Ambiente mínimo, máscara de segredo na saída, arquivos negados, apps ocultos pintados na origem |
| A Órbita briga com o dono pelo mouse | Médio | Entrada real pausa, borda visível, atalho de parar |
| Custo de tokens alto (screenshot de 1.000 a 1.800 tokens, passo de 10 a 15 mil) | Médio | Árvore antes de pixel, roteiros (B4), teto de passos, número medido na F0 |
| Precisão baixa no desktop (o melhor agente público faz ~57% no WindowsAgentArena) | Médio | Começar pelo terminal e pelo navegador, que são mais previsíveis; desktop com meta calibrada, não prometida |
| A Anthropic muda ou restringe o computer use pela assinatura (hoje funciona, §5.6) | Médio | As tools próprias continuam como reserva (`computador.motor: orbita`), e o teste de 10/10 vira teste de fumaça no `/health` |
| Anexo malicioso (macro, executável disfarçado, ZIP bomba, PDF com injeção) | Médio | Tipo pelos bytes, nada executa, tetos de compressão, texto embrulhado como dado, guardar no conhecimento só pela fila |
| Mudança do Chrome ou do Windows quebra a extensão ou o executor | Médio | Versão mínima declarada, `/health` com versão, teste de fumaça na tela |

---

## 14. Métricas e aceite da fase

### 14.1 Lista de tarefas do dono

Escrever antes da F0 e repetir a cada onda. Exemplos:

- "Roda os testes da Órbita e me diz o que quebrou"
- "Quanto de disco sobrou e o que está ocupando"
- "Qual processo está comendo CPU"
- "Abre o card TECH-XXXX no Jira e me resume"
- "Extrai valor e vencimento desse boleto aberto no navegador"
- "Preenche o formulário de reembolso com o último cupom" (para antes de enviar)
- "Fecha o Spotify e abre o VS Code no projeto X"
- "Entra na próxima reunião"
- "Me avisa quando o build acabar"
- "Pausa a música"
- "Vê o e-mail do contador e me diz o que tem na planilha anexada"
- "Lança o boleto que veio no e-mail da Enel"

### 14.2 Metas iniciais (calibradas pela F0)

| Medida | Meta v1 |
|---|---|
| Ações com efeito fora da fila na bancada F8 (estrutural) | **0** |
| Do atalho de parar até a última entrada injetada | < 300 ms |
| Tarefas de terminal e arquivos concluídas | ≥ 90% |
| Tarefas de leitura no navegador | ≥ 85% |
| Tarefas de ação no navegador | ≥ 70% |
| Tarefas de desktop | ≥ 50% (a medir) |
| Tempo das mãos por passo, sem o modelo | < 500 ms |
| Anexos lidos, nos tipos da tabela da C3 | 100% dos tipos com teste, e "não sei ler" honesto no resto |

### 14.3 Aceite

1. `tsc --noEmit` limpo no `apps/web` e no `apps/api`, `vitest run` verde, e os testes do
   `apps/maos` e da extensão verdes.
2. Testes de `execute` com a dependência mockada para cada tool nova (§5.7), incluindo o caminho de
   recusa.
3. A bancada F8 com zero escapes estruturais, e a rodada real documentada.
4. Smoke manual no app real: voz ("pausa a música", "roda o git status", "o que tem no anexo do
   último e-mail"), chat e WhatsApp "Eu".
5. A trilha de uma sessão inteira legível na tela "Controle do PC".
6. O CLAUDE.md atualizado: linhas novas no §8 e armadilhas novas no §9.

---

## 15. Fora de escopo, e o que fica para depois

- Controlar o PC de fora de casa sem passar pelos canais que já existem.
- Mais de um computador (o modelo de dados já tem `maquina`, mas o canal fica para depois, porque
  sair do `127.0.0.1` exige a mesma exceção deliberada do Home Assistant e TLS).
- Delegar tarefa de código ao Claude Code (`claude -p`) como tool. Quando vier, **nunca** com
  `--dangerously-skip-permissions`: o malware s1ngularity (ago/2025) chamou justamente essa flag
  nos agentes que encontrou instalados.
- Captura contínua da tela (estilo Screenpipe, `CHECKLIST.md:161`).
- Agent Workspace e registro de MCP do Windows, quando saírem do preview e esta máquina tiver o build.
- Pôr token no `apps/voice` (§4.2). Vale um item próprio, porque com um executor local na mesma
  máquina o serviço sem autenticação fica mais exposto.

---

## 16. Fontes (consultadas em 2026-10-10)

**Computer use e desktop**
- Anthropic, computer use tool: https://platform.claude.com/docs/en/agents-and-tools/tool-use/computer-use-tool
- Anthropic, boas práticas de computer e browser use: https://claude.com/blog/best-practices-for-computer-and-browser-use-with-claude
- OpenAI, computer use: https://developers.openai.com/api/docs/guides/tools-computer-use
- Gemini 3.5 Flash computer use: https://blog.google/innovation-and-ai/models-and-research/gemini-models/introducing-computer-use-gemini-3-5-flash/
- Microsoft UFO2 (paper com a tabela UIA × visão): https://arxiv.org/html/2504.14603v2 · https://github.com/microsoft/UFO
- Windows-MCP: https://github.com/CursorTouch/Windows-MCP
- Agent S3: https://github.com/simular-ai/Agent-S · UI-TARS-2: https://huggingface.co/papers/2509.02544
- OSWorld: https://osworld-v1.xlang.ai/ · OSWorld-Human (custo por passo): https://arxiv.org/pdf/2506.16042
- MCP no Windows, ODR e contenção: https://learn.microsoft.com/en-us/windows/ai/mcp/overview · https://learn.microsoft.com/en-us/windows/ai/mcp/servers/mcp-containment
- Segurança agêntica do Windows: https://learn.microsoft.com/en-au/windows/security/book/operating-system-agentic-security
- SendInput e UIPI: https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput
- Serviços e sessão 0: https://learn.microsoft.com/en-us/windows/desktop/Services/interactive-services

**Terminal e sandbox**
- Claude Code, sandbox e permissões: https://code.claude.com/docs/en/sandboxing · https://code.claude.com/docs/en/permissions
- Codex, sandbox no Windows: https://learn.chatgpt.com/docs/windows/windows-sandbox
- Gemini CLI, sandbox: https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/sandbox.md
- Desktop Commander MCP: https://github.com/wonderwhy-er/DesktopCommanderMCP
- Parser do PowerShell: https://learn.microsoft.com/en-us/dotnet/api/system.management.automation.language.parser.parseinput
- Job Objects: https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects
- Windows Sandbox CLI: https://learn.microsoft.com/en-us/windows/security/application-security/application-isolation/windows-sandbox/windows-sandbox-cli
- node-pty: https://github.com/microsoft/node-pty
- Furo do Gemini CLI: https://bleepingcomputer.com/news/security/flaw-in-gemini-cli-ai-coding-assistant-allowed-stealthy-code-execution
- s1ngularity/Nx: https://www.ox.security/blog/nx-supply-chain-breach-how-s1ngularity-weaponized-ai/

**Chrome**
- Mudança do remote debugging no Chrome 136: https://developer.chrome.com/blog/remote-debugging-port
- Chrome DevTools MCP no perfil real: https://developer.chrome.com/blog/chrome-devtools-mcp-debug-your-browser-session · https://github.com/ChromeDevTools/chrome-devtools-mcp
- Ciclo de vida do service worker: https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle
- WebSocket em extensão: https://developer.chrome.com/docs/extensions/how-to/web-platform/websockets
- Native messaging: https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging
- `chrome.debugger`: https://developer.chrome.com/docs/extensions/reference/api/debugger
- Playwright MCP: https://github.com/microsoft/playwright-mcp
- Claude in Chrome (arquitetura e GA): https://code.claude.com/docs/en/chrome · https://claude.com/blog/claude-in-chrome-generally-available
- Stagehand, cache: https://docs.stagehand.dev/v3/best-practices/caching
- Online-Mind2Web: https://arxiv.org/html/2504.01382v4

**Segurança**
- Anthropic, defesas contra prompt injection: https://www.anthropic.com/news/prompt-injection-defenses
- Anthropic, piloto do Claude for Chrome: https://claude.com/blog/claude-for-chrome
- Zenity Labs, do alerta à tomada de conta: https://labs.zenity.io/post/claude-in-chrome-from-alert-to-full-account-takeover
- Google, segurança do Chrome agêntico (crítico e Origin Sets): https://blog.google/security/architecting-security-for-agentic/
- OpenAI, endurecimento do Atlas: https://openai.com/index/hardening-atlas-against-prompt-injection
- Brave sobre o Comet: https://brave.com/blog/comet-prompt-injection/ · https://brave.com/blog/unseeable-prompt-injections/
- HashJack: https://www.theregister.com/2025/11/25/hashjack_attack_ai_browser_hashtag/
- Regra de Dois: https://simonw.substack.com/p/new-prompt-injection-papers-agents
- CaMeL: https://arxiv.org/pdf/2503.18813 · padrões de projeto: https://arxiv.org/abs/2506.08837
- OWASP Top 10 para aplicações agênticas 2026: https://www.giskard.ai/knowledge/owasp-top-10-for-agentic-application-2026
- OpenClaw (CVE-2026-25253): https://www.morphllm.com/openclaw-security
- Transporte do MCP (Origin, localhost): https://modelcontextprotocol.io/specification/2025-11-25/basic/transports

Números de benchmark são quase todos declarados pelos próprios autores e medidos em condições
diferentes. Servem para ordem de grandeza, não para comparar um com o outro.
