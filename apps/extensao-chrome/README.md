# Órbita no Chrome (extensão)

As mãos da Órbita no Chrome do dono (PRD-COMPUTADOR-E-NAVEGADOR, frente B). A extensão
**executa, não decide**: risco, sessão, crítico e fila moram no `packages/core`. Mas ela repete as
travas duras do lado dela: recusa ordem de rotina ou regra, recusa site bloqueado (nem o título
sai), só age nas abas do grupo "Órbita: …" e em site do envelope, e mascara senha, cartão e
código antes de qualquer byte sair.

## Instalar no Chrome do dono (passo manual)

O Chrome de marca **ignora `--load-extension`** (medido no 155, ver `MEDICAO.md`), então a
instalação é à mão, uma vez:

1. Construir: `node scripts/build.mjs` (gera `dist/`; precisa do Node 22, CLAUDE.md §3).
2. No Chrome, abrir `chrome://extensions`, ligar o **Modo do desenvolvedor** (canto superior direito).
3. **Carregar sem compactação** e escolher a pasta `apps/extensao-chrome/dist`.
4. Conferir que o ID mostrado é `cbjgpcknhpiklccdmhcodnhddpmogjcd` (`node scripts/id-da-extensao.mjs`).
   O ID é fixo pela `key` do manifesto, e é ele que o canal confere no `Origin`.
5. Na Órbita, **Ajustes → Controle do PC → Extensão do Chrome → Parear extensão**: aparece um
   código de 6 dígitos que vale 5 minutos.
6. Clicar no ícone da extensão, digitar o código e **Parear**. O primeiro pareamento grava o ID em
   `navegador.extensaoId` sozinho (ou rode `node ../api/node_modules/tsx/dist/cli.mjs scripts/gravar-id.ts`
   antes).

Depois de mudar o código da extensão: `node scripts/build.mjs` e o botão de recarregar em
`chrome://extensions`.

### Native messaging (opcional, B7)

Com a ponte instalada, a extensão fala com a Órbita por native messaging primeiro (o
`allowed_origins` sem curinga garante que só esta extensão inicia a ponte) e cai para o WebSocket
se ela não responder.

```bash
node ponte/instalar.mjs            # registra em HKCU\Software\Google\Chrome\NativeMessagingHosts (sem administrador)
node ponte/instalar.mjs --remover  # desfaz o registro e apaga os arquivos gerados
```

O instalador é idempotente (rodar de novo regrava igual, com o mesmo segredo) e usa o mesmo `node` que o
executou. A tela **Ajustes → Controle do PC → Extensão do Chrome** mostra se a ponte está instalada e ativa, e
instala ou remove pelo mesmo instalador (rota `POST /api/navegador/ponte`, só o dono). `node ponte/instalar.mjs
--estado` imprime o estado em JSON.

**O segredo da ponte.** Sem `Origin`, o canal só aceita a ponte que mostra o segredo de um arquivo que o
instalador gera (32 bytes aleatórios, em `%LOCALAPPDATA%\Orbita\ponte\segredo`, ou `ORBITA_PONTE_SEGREDO`) com ACL
sem herança só para a sua conta do Windows (`icacls /inheritance:r /grant:r`). O apps/api lê o mesmo arquivo. Antes
a ponte se anunciava com `x-orbita-ponte: 1`, que qualquer processo da máquina sabia mandar. A ponte também repassa
a origem que o Chrome lhe deu, e o canal confere que é a extensão configurada (inclusive para parear). Remover a
ponte apaga o segredo.

## Quem é quem: o ID e o token

O ID da extensão (`cbjgpcknhpiklccdmhcodnhddpmogjcd`) sai da `key` PÚBLICA do manifesto: ele é fixo e qualquer um
que copiar o manifesto tem o mesmo ID. Ele só serve para o canal conferir o `Origin` (uma página web não consegue
mentir o `Origin`). Quem AUTENTICA é o token do pareamento, que fica no `chrome.storage.local` da extensão (com
acesso só das páginas da própria extensão quando o Chrome deixa, `setAccessLevel`) e do qual o banco só guarda o
hash. O token vence em `navegador.tokenValidadeDias` (90 dias); parear de novo na mesma extensão revoga o anterior;
"Esquecer" no popup revoga no servidor quando a Órbita está no ar (fora do ar, avisa para revogar na tela); e um
token recusado três vezes seguidas faz a extensão parar de tentar até um pareamento novo.

## Como funciona

- **Canal:** `ws://127.0.0.1:3010/api/navegador/canal`. O token vai na primeira mensagem, nunca na
  URL. Keepalive a cada `navegador.keepaliveSeg` (20 s; o service worker morre com 30 s parado) e
  um alarme por minuto que reconecta se ele morreu mesmo assim.
- **Estado:** `chrome.storage.local` (token, endereço) e `chrome.storage.session` (envelope, grupo,
  "parado"). Nada importante fica só em variável.
- **Ler:** `chrome.scripting.executeScript` no mundo ISOLADO (o mapa de refs fica onde a página não
  alcança), com a função de `packages/core/src/navegador/pagina.ts`, a mesma do perfil dedicado.
- **Ver e agir:** `chrome.debugger` (CDP). A faixa amarela "começou a depurar este navegador" FICA
  (decisão do dono), e o "Cancelar" dela para tudo.
- **Grupo de abas:** toda aba que a Órbita abre entra em "Órbita: <objetivo>"; aba que o dono
  arrasta para o grupo entra no escopo. No fim da sessão o grupo é desfeito (as abas ficam).
- **Parar:** o botão vermelho na barra do topo da aba, o do popup e o do painel lateral cortam do
  lado da extensão (soltam o depurador, tiram a borda) e só depois avisam o api.
- **O dono mexeu:** clique ou tecla de verdade numa aba do grupo, fora da janela de ação da Órbita
  (`navegador.agindoMs`), pausa a sessão. O clique da Órbita por CDP também chega como `isTrusted`;
  por isso a página é marcada antes de cada ação.

## Testes

Rodam do `apps/web` (o vitest do monorepo):

```bash
node ./node_modules/vitest/vitest.mjs run ../extensao-chrome/test/e2e.test.ts      # extensão de ponta a ponta + bancada F8
node ./node_modules/vitest/vitest.mjs run ../extensao-chrome/test/dedicado.test.ts # rotina no perfil dedicado (B5, B6)
node ./node_modules/vitest/vitest.mjs run ../extensao-chrome/test/nativo.test.ts   # native messaging (B7)
node ./node_modules/vitest/vitest.mjs run ../extensao-chrome/test/ponte.test.ts    # quadros e a ponte como processo
```

Os de ponta a ponta usam o Chrome for Testing que o Playwright guarda em
`%LOCALAPPDATA%\ms-playwright` (ou `ORBITA_CHROMIUM_TESTE`), num perfil temporário, e o banco de
dev com um usuário temporário apagado no fim. A medição do B0 está em `test/medicao.test.ts` (só roda
com `ORBITA_MEDIR=1`).

**Sem o Chrome for Testing os de ponta a ponta são PULADOS, e o pulo aparece**: o relatório mostra um
`it.skip` com o motivo e um aviso no console. Para ter o Chromium de teste (ele aceita `--load-extension`; o
Chrome de marca não):

```bash
npx playwright install chromium   # baixa para %LOCALAPPDATA%\ms-playwright\chromium-NNNN
# ou: ORBITA_CHROMIUM_TESTE=C:\caminho\para\chrome.exe
```

Os testes do que roda na página (`test/pagina.test.ts`: sanitização, campo sensível, a máscara conferida nos
pixels e o ponto do clique) usam o mesmo Chromium, sem a extensão.

O `test/nativo.test.ts` escreve nas chaves do Chromium e do Chrome for Testing no HKCU (e apaga no fim). Por isso
ele só roda pedido: `ORBITA_E2E_NATIVO=1`. O instalador (segredo, ACL, idempotência) é testado sempre, em
`test/ponte.test.ts`, numa chave que nenhum navegador lê (`HKCU\Software\OrbitaTeste`).

A bancada de ataque (F8) mora em `bancada/` (ver o README de lá).
