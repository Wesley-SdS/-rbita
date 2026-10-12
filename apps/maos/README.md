# apps/maos: as mãos da Órbita no Windows

Serviço local (Python 3.12 + FastAPI, porta 8003, só em `127.0.0.1`) que executa as ordens das tools
de terminal, arquivos e computador (PRD-COMPUTADOR-E-NAVEGADOR, frente A). Quem decide risco, sessão,
crítico e fila é o `packages/core`; as mãos executam uma ordem concreta e **repetem as travas do lado
delas**: recusam subir elevadas ou sem token, recusam `Origin`, recusam ordem fora do envelope
espelhado, digitar em campo de senha, agir em janela de administrador ou de app oculto, e clicar se a
assinatura do alvo mudou ("a tela mudou").

Medições: `MEDICAO.md`.

## Instalar

1. Venv com Python 3.12 (o mesmo do `apps/perception`), uma vez:

   ```powershell
   cd apps\maos
   py -3.12 -m venv .venv            # ou: uv venv --python 3.12 .venv
   .venv\Scripts\python -c "import tomllib;print('\n'.join(tomllib.load(open('pyproject.toml','rb'))['project']['dependencies']))" > $env:TEMP\maos-req.txt
   .venv\Scripts\python -m pip install -r $env:TEMP\maos-req.txt pytest "httpx<1"
   ```

2. A tarefa de logon, num PowerShell **comum** (o script recusa rodar como administrador):

   ```powershell
   powershell -ExecutionPolicy Bypass -File apps\maos\scripts\instalar.ps1
   ```

   O script:
   - gera o `MAOS_TOKEN` (64 caracteres hex) no `.env` da raiz **só se ainda não existir**, sem mostrar
     o valor;
   - registra a tarefa **"Orbita Maos"** no Agendador de Tarefas: dispara ao fazer logon deste usuário,
     roda `.venv\Scripts\pythonw.exe servir.py` (sem janela), nível de execução **Limitado** (nunca o
     mais alto), prioridade **4 (normal)**, sem teto de duração e com uma instância só;
   - sobe a tarefa e confere o `/health` com o token, esperando até 180 s (`-EsperarSeg`) e
     dizendo o andamento a cada 15 s.

   Rodar de novo é seguro: a tarefa é regravada igual e o token não muda. Para ver o que seria
   registrado sem mudar nada: `-Seco` (vale também com `-Remover`).

   **Por que prioridade 4.** Sem dizer nada, o Agendador cria a tarefa com prioridade 7 (abaixo do
   normal). Num teste de reinstalação com a máquina ocupada, o processo das mãos ficou com a thread
   pronta e sem CPU (1 s de CPU em 11 min) e o instalador desistia antes de ele subir. Uma tarefa
   instalada antes desta mudança continua com 7; para ajustar sem reinstalar, num PowerShell comum:

   ```powershell
   $t = Get-ScheduledTask -TaskName "Orbita Maos"
   $t.Settings.Priority = 4
   Set-ScheduledTask -InputObject $t
   (Get-ScheduledTask -TaskName "Orbita Maos").Settings.Priority   # deve mostrar 4
   ```

   A prioridade nova vale a partir da próxima vez que a tarefa subir (logon, ou
   `Stop-ScheduledTask` e `Start-ScheduledTask`).

3. Reinicie o `apps/api` para ele ler o token (ele lê o `.env` só ao subir). Depois disso,
   `GET /api/health` mostra `maos: up`, e as tools de computador aparecem no turno (com
   `controle.ativo` ligado).

Por que tarefa de logon e não serviço do Windows: serviço roda na sessão 0, que não enxerga a área de
trabalho do dono.

## Remover

```powershell
powershell -ExecutionPolicy Bypass -File apps\maos\scripts\instalar.ps1 -Remover               # tira a tarefa e encerra as mãos
powershell -ExecutionPolicy Bypass -File apps\maos\scripts\instalar.ps1 -Remover -ApagarToken  # e apaga o MAOS_TOKEN do .env
```

## Iniciar e parar à mão

- Iniciar: `Start-ScheduledTask -TaskName "Orbita Maos"`, ou, para ver o log no console,
  `.venv\Scripts\python.exe servir.py` (uma instância por porta: com a tarefa rodando, a segunda sai
  com código 4).
- Parar tudo o que as mãos estão fazendo: o atalho global (`controle.atalhoParar`, padrão
  `Ctrl+Alt+Esc`), o ícone da bandeja, ou o botão Parar da tela "Controle do PC".

  **Aviso sobre o `Ctrl+Alt+Esc`.** O atalho global engole o Esc, mas o Ctrl+Alt chega ao app em
  primeiro plano, e um Alt solto deixa vários apps (o Bloco de Notas, por exemplo) no modo de teclas
  de acesso: o menu fica sublinhado, o elemento sob o ponto muda e a ação seguinte da Órbita dá "a
  tela mudou". Parar continua funcionando; o efeito é só no app da frente. Se atrapalhar, troque a
  chave `controle.atalhoParar` (Ajustes, Controle do PC) por um atalho que termine numa tecla que
  nenhum app usa com Alt, como `Ctrl+Alt+F12` ou `Ctrl+Shift+F12`. O padrão não muda sozinho:
  trocar é decisão do dono.
- Encerrar o processo: `Stop-ScheduledTask -TaskName "Orbita Maos"`, ou `-Remover`.
- Log (sem console): `%LOCALAPPDATA%\Orbita\maos\maos.log`.

## Chaves

Do `.env` da raiz, as mãos leem **só** estas três (os outros segredos da Órbita nunca entram no
processo, e por isso não têm como vazar para um comando filho):

| Chave | Padrão | O que faz |
|---|---|---|
| `MAOS_TOKEN` | nenhum | Segredo dividido com o `apps/api`, no cabeçalho `x-orbita-maos` dos dois lados. Sem ele as mãos não sobem (código 2) |
| `MAOS_PORTA` | `8003` | Porta em `127.0.0.1`. Mudou aqui, mude `maos.url` na tela |
| `ORBITA_API_URL` | `http://127.0.0.1:3010` | Para onde as mãos avisam que pararam (atalho, mouse do dono) |

Só para teste e desenvolvimento, do ambiente do processo: `MAOS_PORTA_TESTE` (sobe noutra porta) e
`MAOS_SEM_BANDEJA=1` (sem ícone nem atalho).

Na tela (Preferências, Controle do PC; todas com `OwnerGuard`):

| Chave | O que faz |
|---|---|
| `maos.url` | Onde o core procura as mãos. Só loopback é aceito |
| `maos.timeoutMs` | Prazo de cada pedido às mãos (captura e digitação longa têm prazo próprio) |
| `maos.saudeSegundos` | Ritmo do laço `maos` do processo vivo (`/health`, config e avisos pendentes). As tools somem do turno 2 min depois de as mãos caírem |
| `computador.appsOcultos` | Apps pintados de preto na captura e fora da árvore, já nas mãos |
| `computador.resolucaoCaptura` | Tamanho da imagem que vai ao modelo (padrão 1280x720) |
| `computador.elementosMax` | Teto de elementos da árvore de acessibilidade por leitura |
| `computador.rotulosDeEfeito` | Rótulos de botão que viram proposta mesmo dentro da sessão (enviar, pagar, excluir…) |
| `computador.pausaEntrePassosMs` | Espera entre as ações de um lote |
| `computador.motor` · `computador.modeloMotor` · `computador.escalarParaOpus` | Quem dirige a tarefa delegada no Windows (Claude ou as tools da Órbita), o modelo e a escalada opcional para o Opus |
| `computador.passosPorTarefa` · `computador.tokensPorTarefa` · `computador.capturasNoContexto` · `computador.contextoMaxTokens` | Tetos e custo da tarefa delegada: ações, tokens, capturas inteiras no histórico e quando compactar |
| `computador.esperaAprovacaoMin` · `computador.pausaMaxMs` · `computador.travadoSeg` | Quanto a tarefa espera uma aprovação, o teto do "aguardar" do Claude e o tempo que dá a um app que não responde |
| `computador.appsRecusados` | Apps que a tarefa nunca toca, mesmo no envelope (navegadores: o caminho é a tarefa do Chrome) |
| `controle.atalhoParar` | O atalho global de parar, empurrado às mãos pelo laço (padrão `Ctrl+Alt+Esc`; alternativas sem o efeito do Alt no app da frente: `Ctrl+Alt+F12`, `Ctrl+Shift+F12`, ver "Iniciar e parar à mão") |
| `terminal.*` · `arquivos.*` | Terminais, pastas, comandos de leitura, variáveis herdadas e arquivos negados |

## Rotas

Todas exigem o token e recusam `Origin` e `Host` que não seja local (401 sem token, 403 com `Origin`).
`GET /health` · `PUT /envelope` · `POST /envelope/fim` · `POST /parar` · `PUT /config` ·
`POST /terminal/{analisar,executar}` · `/pty/*` · `GET /sistema` · `/processos*` · `POST /midia` ·
`POST /computador/{janelas,ver,capturar,no-ponto,focado,elemento,agir,abrir}` ·
`POST /arquivos/{lixeira,salvar}`.

`POST /terminal/analisar` com `pasta` devolve, além dos fatos do parser, `caminhos_reais`: o caminho
final (link, junção, nome curto 8.3, curinga expandido, fluxo do NTFS) de cada argumento que existe
naquela pasta, para o core conferir com os arquivos negados. Sem `pasta` (é assim que o
`gerar_fatos_risco.py` gera a fixture do core), só os fatos do parser.

## Testes

```powershell
cd apps\maos
.venv\Scripts\python.exe -m pytest -q
```
