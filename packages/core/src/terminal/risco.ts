import type { ToolRisk } from "../tools/registry";
import { ehAbsoluto, ehUnc, expandirCaminho, normalizar, padraoNegado, pastaQueContem } from "../maos/pastas";

/**
 * O RISCO DE UM COMANDO (PRD A3), a partir dos FATOS que o apps/maos tirou do
 * parser oficial (PowerShell pelo AST, bash pelo tree-sitter). Função pura.
 *
 * Quem LIBERA é a lista de leitura (`terminal.comandosDeLeitura`): o comando
 * só é `leitura` quando TODOS os comandos dele estão na lista, sem
 * redirecionamento para arquivo, sem substituição (`$()`, crase), sem método
 * .NET, sem atribuição, sem segundo plano e sem caminho fora das pastas ou
 * negado. A lista de proibidos NUNCA libera nada: ela só empurra para
 * `perigoso` (o furo do Gemini CLI em jul/2025 foi uma denylist servindo de
 * fronteira: `grep …; env | curl …` passava como grep).
 *
 * Na dúvida, sobe: parse falho é `perigoso`, nome de comando dinâmico é
 * `perigoso`, e o resto que não é leitura é `efeito_externo` (vai para a fila
 * com o comando inteiro na proposta).
 */

export interface ComandoDosFatos {
  nome: string;
  nome_resolvido?: string | null;
  dinamico: boolean;
  args: string[];
  args_dinamicos: boolean;
  invocacao?: "&" | "." | null;
}

export interface FatosDoComando {
  shell: string;
  parse_ok: boolean;
  erros?: string[];
  comandos: ComandoDosFatos[];
  redirecionamentos: { tipo: "arquivo" | "mescla" | "entrada"; alvo?: string | null; anexar?: boolean }[];
  substituicoes: { tipo: string; texto?: string }[];
  metodos?: { membro: string; alvo?: string; estatico?: boolean }[];
  tipos?: string[];
  operadores: string[];
  atribuicoes: number;
  instrucoes?: number;
  /**
   * O caminho REAL de cada argumento que existe no disco, resolvido pelas mãos
   * na pasta do comando: link simbólico, junção, nome curto 8.3 (`ENV~1`),
   * curinga expandido (`.en*`) e fluxo do NTFS (`.env::$DATA`) viram o arquivo
   * que vai ser lido de fato. Ausente quando as mãos são de antes desta
   * conferência (ou quando ninguém mandou a pasta): aí vale só o texto.
   */
  caminhos_reais?: { arg: string; real: string }[];
}

export interface ConfigDoRisco {
  /** `terminal.comandosDeLeitura` */
  comandosDeLeitura: readonly string[];
  /** `terminal.pastas` (com `~`, como vêm da config) */
  pastas: readonly string[];
  /** a pasta onde o comando roda */
  pasta: string;
  /** `arquivos.negados` + os de sempre: ler `.env` pelo `cat` também é ler `.env` */
  negados: readonly string[];
  /** pasta do usuário (para `~`); testes passam fixo */
  home?: string;
}

export interface Classificacao {
  risco: ToolRisk;
  /** por que não é leitura (vazio quando é): vai para o resumo da proposta */
  motivos: string[];
}

const base = (nome: string) =>
  (nome ?? "")
    .trim()
    .toLowerCase()
    .replace(/^["']|["']$/g, "")
    .replace(/\.(exe|cmd|bat|com)$/, "");

/** Interpretador que recebe um TEXTO para rodar: o texto não foi analisado, então é perigoso. */
const INTERPRETADORES = new Set([
  "cmd", "powershell", "pwsh", "powershell_ise", "bash", "sh", "zsh", "dash", "ksh", "fish", "wsl", "wslhost", "wscript", "cscript", "mshta",
  "rundll32", "regsvr32", "msiexec", "installutil", "regasm", "regsvcs", "msbuild", "cmstp", "forfiles", "pcalua", "conhost", "start", "explorer",
]);
/** Roda texto como código dentro do próprio PowerShell. */
const EXECUTA_TEXTO = new Set(["invoke-expression", "iex", "invoke-command", "icm", "add-type", "invoke-item", "ii", "start-job", "start-threadjob", "new-pssession", "enter-pssession", "invoke-wmimethod", "invoke-cimmethod"]);
/** Muda o sistema de um jeito que não se desfaz com um clique, ou escapa do Job Object. */
const SISTEMA = new Set([
  "runas", "sudo", "gsudo", "su", "doas", "wmic", "set-wmiinstance", "set-ciminstance", "new-ciminstance", "register-wmievent", "register-cimindicationevent",
  "schtasks", "register-scheduledtask", "set-scheduledtask", "new-scheduledtask", "sc", "new-service", "set-service", "reg", "regedit", "regini",
  "format", "format-volume", "diskpart", "clear-disk", "initialize-disk", "remove-partition", "bcdedit", "vssadmin", "wbadmin", "cipher", "takeown", "icacls", "cacls",
  "shutdown", "stop-computer", "restart-computer", "set-executionpolicy", "set-mppreference", "add-mppreference", "netsh", "net", "net1", "new-localuser",
  "add-localgroupmember", "set-localuser", "clear-recyclebin", "dd", "mkfs", "fdisk", "chown", "setx", "certutil", "bitsadmin", "mountvol", "fsutil",
  "set-itemproperty", "new-itemproperty", "remove-itemproperty", "rename-itemproperty",
]);
const DOWNLOAD = new Set(["invoke-webrequest", "iwr", "curl", "wget", "invoke-restmethod", "irm", "start-bitstransfer", "certutil", "bitsadmin", "scp", "sftp", "ftp", "tftp", "aria2c"]);
const APAGAR = new Set(["remove-item", "rm", "ri", "del", "erase", "rd", "rmdir", "rmd"]);
const TIPOS_PERIGOSOS = /(reflection\.assembly|system\.reflection|\bassembly\]|diagnostics\.process|net\.webclient|net\.http|net\.sockets|convert\]?::frombase64|frombase64string|runtime\.interopservices|management\.automation\.(powershell|runspaces)|microsoft\.win32\.registry|activator)/i;
const REGISTRO = /^(hklm|hkcu|hkcr|hku|hkcc|hkey_[a-z_]+)(:|\\|\/|$)|^registry::/i;
/** Argumentos que GRAVAM, em qualquer comando da lista de leitura (`git log --output=x`, `-OutFile`). */
const ARG_QUE_GRAVA = /^-{1,2}(o|out|output|outfile|out-file|output-file|output-directory|outvariable|ov|exec|ext-diff|upload-pack|receive-pack|config)([=:]|$)/i;
/** Por subcomando do git: o que muda o repositório mesmo com "branch" ou "remote" na frente. */
const GIT_QUE_MUDA = new Set(["-d", "-D", "--delete", "-m", "-M", "--move", "-c", "-C", "--copy", "--set-upstream-to", "-u", "--unset-upstream", "--edit-description", "-f", "--force", "add", "rm", "remove", "rename", "set-url", "prune", "set-head", "set-branches", "update"]);

interface EntradaDaLista {
  tokens: string[];
}

function lista(cfg: ConfigDoRisco): EntradaDaLista[] {
  return cfg.comandosDeLeitura
    .map((l) => l.trim().split(/\s+/).filter(Boolean))
    .filter((t) => t.length > 0)
    .map((t) => ({ tokens: t.map((x) => x.toLowerCase()) }));
}

/** O nome que o comando tem na lista: o escrito (`ls`) ou o resolvido do alias (`Get-ChildItem`). Caminho nunca casa. */
function nomesDoComando(c: ComandoDosFatos): string[] {
  const n = base(c.nome);
  if (/[\\/]/.test(n) || /^[a-z]:/.test(n)) return [];
  const r = c.nome_resolvido ? base(c.nome_resolvido) : null;
  return [...new Set([n, ...(r && !/[\\/]/.test(r) ? [r] : [])])];
}

/** A entrada da lista que libera este comando, e os argumentos que sobram depois dela. */
function casaNaLista(c: ComandoDosFatos, entradas: EntradaDaLista[]): { entrada: string[]; resto: string[] } | null {
  const nomes = nomesDoComando(c);
  if (!nomes.length) return null;
  const args = c.args.map((a) => a.toLowerCase());
  let melhor: { entrada: string[]; resto: string[] } | null = null;
  for (const e of entradas) {
    if (!nomes.includes(e.tokens[0]!)) continue;
    const resto = e.tokens.slice(1);
    if (resto.length > args.length) continue;
    if (!resto.every((t, i) => args[i] === t)) continue;
    // a entrada mais específica ganha ("git remote -v" antes de um eventual "git")
    if (!melhor || e.tokens.length > melhor.entrada.length) melhor = { entrada: e.tokens, resto: c.args.slice(resto.length) };
  }
  return melhor;
}

/** Tira o "-Path:" da frente de um argumento PowerShell e as aspas. */
function valorDoArg(a: string): string {
  const m = /^-[A-Za-z]+:(.+)$/.exec(a);
  return (m ? m[1]! : a).replace(/^["']|["']$/g, "");
}

const pareceCaminho = (v: string) => /[\\/]/.test(v) || /^[a-zA-Z]:/.test(v) || v.startsWith("~") || v.startsWith(".") || /^\$(env:)?(userprofile|home)/i.test(v) || /^%[a-z]+%/i.test(v);

/** Motivos de um argumento NÃO ser de leitura (caminho fora, negado, `..`). Vazio quando está tudo bem. */
function problemasDoArg(a: string, cfg: ConfigDoRisco, perigos: string[]): string[] {
  const v = valorDoArg(a);
  if (!v || /^-/.test(v)) return [];
  const out: string[] = [];
  if (ehUnc(v)) perigos.push(`caminho de rede (${v.slice(0, 60)})`);
  if (REGISTRO.test(v)) perigos.push(`Registro do Windows (${v.slice(0, 60)})`);
  const negado = padraoNegado(expandirCaminho(v, cfg.home), cfg.negados);
  if (negado) out.push(`toca em arquivo protegido (${negado})`);
  if (!pareceCaminho(v)) return out;
  if (/(^|[\\/])\.\.([\\/]|$)/.test(v)) out.push(`caminho com ".." (${v.slice(0, 60)})`);
  const exp = expandirCaminho(v, cfg.home);
  if (ehAbsoluto(exp) || v.startsWith("~") || /^\$|^%/.test(v)) {
    if (!pastaQueContem(exp, cfg.pastas, undefined, cfg.home)) out.push(`caminho fora das pastas liberadas (${v.slice(0, 60)})`);
  } else if (!pastaQueContem(exp, cfg.pastas, cfg.pasta, cfg.home)) {
    out.push(`caminho fora das pastas liberadas (${v.slice(0, 60)})`);
  }
  return out;
}

/** `\\?\C:\x` e `\\.\PhysicalDrive0` (com barra normal também): o Windows não normaliza esse caminho. */
function ehCaminhoDeDispositivo(v: string): boolean {
  const barra = (c: string | undefined) => c === "\\" || c === "/";
  return v.length >= 4 && barra(v[0]) && barra(v[1]) && (v[2] === "?" || v[2] === ".") && barra(v[3]);
}

/**
 * Os TRUQUES de caminho num argumento de um comando da lista de leitura (G1 da
 * auditoria de 11/10/2026). A comparação com os negados é de texto, e o
 * Windows lê o mesmo arquivo por vários nomes: `Get-Content ENV~1` (nome curto
 * 8.3), `.env::$DATA` (fluxo do NTFS), `cat .en*` e `Get-Content *env`
 * (curinga) liam o `.env` sem aprovação. Em vez de tentar adivinhar o que cada
 * forma resolve, qualquer argumento com curinga, nome curto, variável ou
 * dois-pontos fora da unidade deixa de ser leitura: vai para a fila com o
 * comando inteiro. Caminho de dispositivo (`\\?\`, `\\.\`) e fluxo do NTFS
 * são `perigoso` (só pela tela). O caminho REAL que as mãos resolvem
 * (`caminhos_reais`) cobre o que o texto não mostra: link e junção.
 */
function truquesDoArg(a: string, ehGit: boolean, perigos: string[], naoLeitura: string[]): void {
  const v = valorDoArg(a);
  if (!v || v.startsWith("-")) return;
  const rotulo = v.slice(0, 60);
  const dispositivo = ehCaminhoDeDispositivo(v);
  if (dispositivo) perigos.push(`caminho de dispositivo do Windows (${rotulo})`);
  if (v.includes("*") || v.includes("?")) naoLeitura.push(`curinga no caminho (${rotulo}): pode casar com um arquivo protegido`);
  if (v.includes("[") && v.includes("]")) naoLeitura.push(`curinga de colchetes no caminho (${rotulo})`);
  // "HEAD~1" do git é revisão, não nome curto; num caminho de verdade, "~1" é o 8.3 do Windows
  if (/~\d/.test(v) && (!ehGit || pareceCaminho(v))) naoLeitura.push(`nome curto do Windows (8.3) no caminho (${rotulo})`);
  const temVariavel = /%[^%\s]+%/.test(v) || /\$(env:)?[A-Za-z_{(]/i.test(v);
  if (temVariavel) naoLeitura.push(`variável no caminho (${rotulo})`);
  // dois-pontos fora da letra da unidade: fluxo alternativo do NTFS (`.env:x`, `.env::$DATA`) ou unidade do PowerShell (`env:`)
  if (/\s/.test(v) || /^[a-z][a-z0-9+.-]*:\/\//i.test(v)) return;
  const resto = (dispositivo ? v.slice(4) : v).replace(/^[a-zA-Z]:/, "").replace(/\$env:[A-Za-z_][A-Za-z0-9_]*/gi, "");
  if (!resto.includes(":")) return;
  if (ehGit) naoLeitura.push(`"revisão:caminho" do git lê o conteúdo de um arquivo (${rotulo})`);
  else if (/^[A-Za-z][A-Za-z0-9_]+:[^:]*$/.test(resto) && !REGISTRO.test(v)) naoLeitura.push(`unidade do PowerShell no caminho (${rotulo})`);
  else perigos.push(`fluxo alternativo do NTFS no caminho (${rotulo})`);
}

/** O comando toca num arquivo protegido, pelo texto de algum argumento ou pelo caminho real? Para a máscara total da saída. */
export function tocaArquivoProtegido(f: FatosDoComando, cfg: Pick<ConfigDoRisco, "negados" | "home">): boolean {
  for (const c of f.comandos) {
    for (const a of c.args) {
      const v = valorDoArg(a);
      if (v && padraoNegado(expandirCaminho(v, cfg.home), cfg.negados)) return true;
    }
  }
  for (const r of f.redirecionamentos) if (r.alvo && padraoNegado(expandirCaminho(r.alvo, cfg.home), cfg.negados)) return true;
  return (f.caminhos_reais ?? []).some((r) => padraoNegado(r.real, cfg.negados) !== null);
}

/**
 * O argumento pede apagar recursivo? No PowerShell, parâmetro pode vir abreviado
 * (`-Rec`, `-r`, `-Recurse:$true`); no bash, a letra vem agrupada (`-rf`, `-Rv`);
 * no cmd, é `/s`.
 */
function apagaRecursivo(arg: string, shell: string): boolean {
  const a = arg.toLowerCase();
  if (a === "/s" || a === "--recursive") return true;
  // duas regex simples em vez de `^-[a-z]*r[a-z]*$`, que volta em cada "r" de um argumento comprido
  if (shell === "bash") return !a.startsWith("--") && /^-[a-z]+$/i.test(arg) && a.includes("r");
  const nome = a.split(":")[0]!;
  return nome.length >= 2 && "-recurse".startsWith(nome);
}

export function riscoDoComando(f: FatosDoComando, cfg: ConfigDoRisco): Classificacao {
  const perigos: string[] = [];
  const naoLeitura: string[] = [];

  if (!f.parse_ok) return { risco: "perigoso", motivos: [`não deu para analisar o comando${f.erros?.length ? ` (${f.erros[0]!.slice(0, 120)})` : ""}`] };
  if (!pastaQueContem(cfg.pasta, cfg.pastas, undefined, cfg.home)) perigos.push("a pasta do comando está fora das pastas liberadas");

  const entradas = lista(cfg);
  const nomes = f.comandos.flatMap(nomesDoComando);
  const temDownload = nomes.some((n) => DOWNLOAD.has(n)) || (f.tipos ?? []).some((t) => /net\.webclient|net\.http/i.test(t)) || (f.metodos ?? []).some((m) => /download/i.test(m.membro));
  const temExecucao =
    nomes.some((n) => INTERPRETADORES.has(n) || EXECUTA_TEXTO.has(n) || n === "start-process" || n === "saps" || n === "python" || n === "node" || n === "py") ||
    f.comandos.some((c) => c.invocacao === "&" || c.invocacao === "." || /^\.{1,2}[\\/]|\.(exe|ps1|bat|cmd|sh|vbs|js)$/i.test(c.nome));
  if (temDownload && temExecucao) perigos.push("baixa algo e executa na mesma linha");

  for (const c of f.comandos) {
    const ns = nomesDoComando(c);
    const rotulo = c.nome.slice(0, 60);
    if (c.dinamico) {
      perigos.push(`nome de comando dinâmico (${rotulo})`);
      continue;
    }
    const args = c.args.map((a) => a.toLowerCase());
    if (ns.some((n) => INTERPRETADORES.has(n))) perigos.push(`roda texto em outro interpretador (${rotulo})`);
    if (ns.some((n) => EXECUTA_TEXTO.has(n))) perigos.push(`executa texto como código (${rotulo})`);
    if (ns.some((n) => SISTEMA.has(n))) perigos.push(`mexe no sistema (${rotulo})`);
    if (args.some((a) => /^-e(nc(odedcommand)?|c)?$|^-encodedcommand/i.test(a)) && ns.some((n) => n === "powershell" || n === "pwsh")) perigos.push("comando codificado (-EncodedCommand)");
    if ((ns.includes("start-process") || ns.includes("saps") || ns.includes("start")) && args.some((a) => a.includes("runas"))) perigos.push("pede elevação (RunAs)");
    // ler Win32_Process é leitura de sistema; CRIAR por ele é processo fora do Job Object (PRD §12.7)
    if (args.some((a) => /win32_(process|service|shadowcopy)/.test(a)) && args.some((a) => /create|delete|terminate|change/.test(a))) perigos.push("cria ou muda processo ou serviço por WMI (escapa do Job Object)");
    if (ns.some((n) => APAGAR.has(n)) && args.some((a) => apagaRecursivo(a, f.shell))) perigos.push(`apaga recursivamente (${rotulo})`);
    if (ns.includes("git") && args[0] === "clean" && args.some((a) => /^-[a-z]*f/.test(a))) perigos.push("git clean -f apaga arquivos não versionados");
    if (ns.includes("git") && (args[0] === "reset" && args.includes("--hard"))) perigos.push("git reset --hard descarta alterações");

    const casou = casaNaLista(c, entradas);
    if (!casou) {
      naoLeitura.push(`"${rotulo}" não está na lista de comandos de leitura`);
      for (const a of c.args) problemasDoArg(a, cfg, perigos); // caminho de rede e Registro sobem mesmo fora da lista
      continue;
    }
    if (c.args_dinamicos) naoLeitura.push(`argumento com variável ou expressão em "${rotulo}"`);
    for (const a of casou.resto) {
      if (ARG_QUE_GRAVA.test(a)) naoLeitura.push(`argumento que grava (${a.slice(0, 40)})`);
      if (casou.entrada[0] === "git" && GIT_QUE_MUDA.has(a.toLowerCase())) naoLeitura.push(`"git ${casou.entrada.slice(1).join(" ")} ${a}" muda o repositório`);
    }
    // "git branch nome" cria um branch: só flag passa depois de "git branch"
    if (casou.entrada.join(" ") === "git branch" && casou.resto.some((a) => !a.startsWith("-"))) naoLeitura.push("\"git branch\" com nome cria um branch");
    for (const a of c.args) naoLeitura.push(...problemasDoArg(a, cfg, perigos));
    for (const a of c.args) truquesDoArg(a, casou.entrada[0] === "git", perigos, naoLeitura);
  }

  // o que o argumento É no disco (link, junção, 8.3, curinga expandido), não só o que o texto diz
  for (const r of f.caminhos_reais ?? []) {
    const rotulo = r.arg.slice(0, 60);
    const negado = padraoNegado(r.real, cfg.negados);
    if (negado) naoLeitura.push(`"${rotulo}" é, no disco, um arquivo protegido (${negado})`);
    else if (!pastaQueContem(r.real, cfg.pastas, undefined, cfg.home)) naoLeitura.push(`"${rotulo}" aponta para fora das pastas liberadas (${r.real.slice(0, 80)})`);
  }

  for (const r of f.redirecionamentos) {
    const alvo = r.alvo ?? "";
    if (alvo && ehUnc(alvo)) perigos.push("redireciona para caminho de rede");
    if (r.tipo === "arquivo") naoLeitura.push(`grava em arquivo (${alvo.slice(0, 60) || "redirecionamento"})`);
    if (r.tipo === "entrada" && alvo) {
      naoLeitura.push(...problemasDoArg(alvo, cfg, perigos));
      truquesDoArg(alvo, false, perigos, naoLeitura);
    }
  }
  for (const s of f.substituicoes) if (s.tipo !== "bloco") naoLeitura.push(`substituição de comando (${(s.texto ?? s.tipo).slice(0, 40)})`);
  for (const m of f.metodos ?? []) {
    const alvo = `${m.alvo ?? ""}::${m.membro}`;
    if (TIPOS_PERIGOSOS.test(alvo)) perigos.push(`método .NET perigoso (${alvo.slice(0, 60)})`);
    else naoLeitura.push(`chama método .NET (${alvo.slice(0, 60)})`);
  }
  for (const t of f.tipos ?? []) if (TIPOS_PERIGOSOS.test(t) || TIPOS_PERIGOSOS.test(`${t}]`)) perigos.push(`tipo .NET perigoso (${t.slice(0, 60)})`);
  if (f.atribuicoes > 0) naoLeitura.push("atribui variável");
  // no PowerShell o mesmo `&` é o operador de chamada (`& "x.exe"`), que já foi tratado no comando
  if (f.operadores.includes("&") && !f.comandos.some((c) => c.invocacao === "&")) naoLeitura.push("roda em segundo plano");

  if (perigos.length) return { risco: "perigoso", motivos: [...new Set(perigos)] };
  if (naoLeitura.length) return { risco: "efeito_externo", motivos: [...new Set(naoLeitura)] };
  return { risco: "leitura", motivos: [] };
}

/** Normaliza a pasta para mostrar (e para o apps/maos receber absoluta). */
export function pastaAbsoluta(p: string, home?: string): string {
  return normalizar(p, undefined, home);
}
