/**
 * A SAÍDA do terminal antes de ir ao modelo (PRD A2): cortada em cabeça e
 * cauda e com segredo mascarado. Puro.
 *
 * A máscara pega quatro coisas: o formato de token conhecido (chave da
 * OpenAI, do GitHub, da AWS, do Slack, JWT, chave privada PEM), `nome=valor`
 * e `"nome": "valor"` com nome de segredo, a senha de `usuario:senha` (no
 * endereço e no valor de variável) e os VALORES dos segredos que este
 * processo tem no ambiente. O último é o que importa: um `cat .env` aprovado,
 * ou um script que imprime a configuração, devolveria a chave do conector
 * como texto, e daqui ela iria para a nuvem. Quando o comando leu um arquivo
 * de ambiente (`.env*`), o valor de TODA linha `NOME=valor` some, mesmo com
 * nome genérico: um `.env` de outro projeto tem segredos que a Órbita não
 * conhece pelo nome (`GOWA_BASIC_AUTH`, `ALLOWED_EMAILS`).
 *
 * TUDO AQUI É LINEAR NO TAMANHO DO TEXTO (G2 da auditoria de 11/10/2026). A
 * versão anterior usava `[A-Za-z0-9_.-]*(secret|…)[A-Za-z0-9_.-]*`: em 40 mil
 * caracteres `a.a.a…` cada posição tentava de novo a corrida inteira, e a
 * máscara levava 13,7 s com o laço de eventos parado (chat, WhatsApp e
 * scheduler juntos). Por isso o nome-chave é achado por varredura à mão, a
 * chave PEM por `indexOf`, e toda regex que sobrou começa num literal fixo e
 * não tem repetição aninhada. `saida.test.ts` trava o tempo com o texto
 * patológico de 40 mil e de 400 mil caracteres.
 */

export function cabecaECauda(texto: string, max: number): string {
  if (texto.length <= max) return texto;
  const meia = Math.floor(max / 2);
  const omitidos = texto.length - 2 * meia;
  return `${texto.slice(0, meia)}\n[... ${omitidos} caracteres omitidos ...]\n${texto.slice(texto.length - meia)}`;
}

const SEGREDO = "[segredo]";

/** Formatos de token. Cada um começa num literal fixo: a tentativa que falha não varre o texto de novo. */
const PADROES: RegExp[] = [
  /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{40,}/g,
  /\bglpat-[A-Za-z0-9_-]{20,}/g,
  /\bnpm_[A-Za-z0-9]{36,}/g,
  /\bxox[abeprs]-[A-Za-z0-9-]{10,}/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{35,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
];
/** A senha antes do `@` num endereço com esquema conhecido (o esquema é fixo: nada de `[a-z][a-z0-9+.-]*` varrendo cada palavra). */
const SENHA_NO_ENDERECO = /\b(?:https?|ftps?|sftp|ssh|git|wss?|postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|rediss?|amqps?|smtps?|imaps?|ldaps?):\/\/[^\s:@/]+:[^\s@/]+@/gi;
/** O valor de `Authorization: Bearer …` (e `Basic`): o esquema fica, o token some. */
const ESQUEMA_DE_AUTORIZACAO = /\b(Bearer|Basic)([ \t]+)([A-Za-z0-9._~+/=-]{8,})/gi;

/** Nome de variável cujo VALOR, neste processo, nunca sai. */
const NOME_DE_SEGREDO = /(SECRET|TOKEN|PASSW|API_?KEY|PRIVATE|CREDENTIAL|ENC_KEY|_KEY$|^DATABASE_URL$|AUTH|COOKIE|SESSION|BEARER|DSN|_CONN|EMAILS$)/i;

/** Os valores dos segredos do ambiente deste processo (os que valem mascarar: 8+ caracteres). */
export function segredosDoAmbiente(env: Record<string, string | undefined> = process.env): string[] {
  return Object.entries(env)
    .filter(([k, v]) => NOME_DE_SEGREDO.test(k) && typeof v === "string" && v.length >= 8)
    .map(([, v]) => v as string)
    .sort((a, b) => b.length - a.length);
}

// ── nome-chave com segredo ─────────────────────────────────────────────────
/** Pedaço que, em qualquer lugar do nome (sem `_`, `-` e `.`), diz que o valor é segredo. */
const PEDACOS_DE_SEGREDO = ["secret", "token", "password", "passwd", "senha", "apikey", "privatekey", "enckey", "credential", "cookie", "bearer", "passphrase", "accesskey", "signingkey", "masterkey"];
/**
 * Palavra que só conta INTEIRA (um pedaço entre `_`, `-`, `.` ou na troca de
 * caixa): `auth` é segredo em `GOWA_BASIC_AUTH`, mas "Author:" no `git log`
 * não é; `conn` em `DB_CONN`, mas não em "disconnect".
 */
const PALAVRAS_DE_SEGREDO = new Set(["auth", "authorization", "authentication", "basicauth", "oauth", "oauth2", "session", "sessionid", "conn", "connstr", "connectionstring", "dsn", "jwt", "pwd", "pass", "pat", "otp"]);
/** Valor que é só o esquema: o segredo é a palavra seguinte. */
const ESQUEMAS = new Set(["bearer", "basic", "token", "digest"]);

function ehCharDeNome(c: number): boolean {
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 46 || c === 45;
}
function ehEspaco(c: string | undefined): boolean {
  return c === " " || c === "\t";
}
/** Termina o valor sem aspas: espaço, aspas, crase, vírgula e ponto e vírgula (como a versão de regex). */
function terminaValor(c: number): boolean {
  return c === 32 || c === 9 || c === 10 || c === 13 || c === 12 || c === 11 || c === 34 || c === 39 || c === 96 || c === 44 || c === 59;
}

export function nomeDeSegredo(nome: string): boolean {
  // a menor palavra que conta tem 3 letras: o texto "a=a=a=…" pergunta isto 200 mil vezes
  if (nome.length < 3) return false;
  const n = nome.toLowerCase();
  const compacto = n.includes("_") || n.includes("-") || n.includes(".") ? n.replace(/[_.-]/g, "") : n;
  if (PEDACOS_DE_SEGREDO.some((p) => compacto.includes(p))) return true;
  // os pedaços: separados por _ - . e pela troca de minúscula para maiúscula (sessionId, basicAuth)
  const palavra = (ini: number, fim: number) => fim - ini >= 3 && fim - ini <= 16 && PALAVRAS_DE_SEGREDO.has(n.slice(ini, fim));
  let ini = 0;
  for (let i = 0; i < nome.length; i++) {
    const c = nome.charCodeAt(i);
    if (c === 95 || c === 45 || c === 46) {
      if (palavra(ini, i)) return true;
      ini = i + 1;
    } else if (c >= 65 && c <= 90 && i > 0) {
      const a = nome.charCodeAt(i - 1);
      if (a >= 97 && a <= 122) {
        if (palavra(ini, i)) return true;
        ini = i;
      }
    }
  }
  return palavra(ini, nome.length);
}

/** Até onde vai um valor entre aspas (no máximo 1.000 caracteres: além disso, não confio que é um valor só). */
function fimDasAspas(s: string, ini: number, aspa: string): number {
  const teto = Math.min(s.length, ini + 1000);
  for (let k = ini; k < teto; k++) {
    if (s[k] === "\n") return -1;
    if (s[k] === aspa) return k;
  }
  return -1;
}

function fimDoValor(s: string, ini: number): number {
  let k = ini;
  while (k < s.length && !terminaValor(s.charCodeAt(k))) k++;
  return k;
}

/**
 * `nome=valor`, `nome: valor` e `"nome": "valor"` com nome de segredo: o valor
 * vira `[segredo]`. Varre o texto UMA vez, corrida de caracteres de nome por
 * corrida, e só olha o nome quando ele é seguido de `=` ou `:`.
 */
function mascararChaveValor(s: string): string {
  const n = s.length;
  let out = "";
  let copiado = 0;
  let i = 0;
  while (i < n) {
    if (!ehCharDeNome(s.charCodeAt(i))) {
      i++;
      continue;
    }
    const ini = i;
    while (i < n && ehCharDeNome(s.charCodeAt(i))) i++;
    const fimNome = i;
    let j = fimNome;
    if (s[j] === '"' || s[j] === "'") j++; // a aspa que fecha o nome no JSON
    while (j < n && ehEspaco(s[j])) j++;
    if (s[j] !== "=" && s[j] !== ":") continue;
    if (s[j] === ":" && s[j + 1] === ":") continue; // [Tipo]::Metodo do PowerShell
    j++;
    while (j < n && ehEspaco(s[j])) j++;
    if (!nomeDeSegredo(s.slice(ini, fimNome))) continue;

    let vIni = j;
    let vFim: number;
    const aspa = s[j] === '"' || s[j] === "'" ? s[j]! : "";
    if (aspa) {
      vIni = j + 1;
      vFim = fimDasAspas(s, vIni, aspa);
      if (vFim === -1) vFim = fimDoValor(s, vIni);
    } else {
      vFim = fimDoValor(s, vIni);
    }
    // "Authorization: Bearer xyz": o segredo é o xyz (entre aspas, o valor inteiro já some)
    if (!aspa && ESQUEMAS.has(s.slice(vIni, vFim).toLowerCase()) && ehEspaco(s[vFim])) {
      let k = vFim;
      while (k < n && ehEspaco(s[k])) k++;
      vIni = k;
      vFim = fimDoValor(s, k);
    }
    const valor = s.slice(vIni, vFim);
    const minimo = aspa ? 4 : 6;
    if (valor.length >= minimo && !valor.startsWith(SEGREDO)) {
      out += s.slice(copiado, vIni) + SEGREDO;
      copiado = vFim;
    }
    i = Math.max(vFim, fimNome);
  }
  return copiado === 0 ? s : out + s.slice(copiado);
}

// ── chave privada PEM ──────────────────────────────────────────────────────
const INICIO_PEM = /-----BEGIN [A-Z0-9 ]{0,40}PRIVATE KEY(?: BLOCK)?-----/g;

/** Do BEGIN até o fim do END. Sem END (saída cortada), some até o fim: meia chave ainda é chave. */
function mascararPem(s: string): string {
  if (!s.includes("PRIVATE KEY")) return s;
  let out = "";
  let pos = 0;
  INICIO_PEM.lastIndex = 0;
  for (let m = INICIO_PEM.exec(s); m; m = INICIO_PEM.exec(s)) {
    const fim = s.indexOf("-----END ", m.index + m[0].length);
    let ate = s.length;
    if (fim !== -1) {
      const fecha = s.indexOf("-----", fim + 9);
      ate = fecha === -1 ? s.length : fecha + 5;
    }
    out += s.slice(pos, m.index) + SEGREDO;
    pos = ate;
    INICIO_PEM.lastIndex = ate;
  }
  return out + s.slice(pos);
}

// ── variável de ambiente ───────────────────────────────────────────────────
/**
 * Onde está o `=` de uma linha `NOME=valor` (com `export `, `set ` ou `$env:` na
 * frente, e nome de variável de verdade), ou -1. Sem regex: a linha pode ter
 * 400 mil caracteres.
 */
function igualDaVariavel(l: string): number {
  let k = 0;
  while (k < l.length && ehEspaco(l[k])) k++;
  for (const prefixo of ["export ", "set ", "$env:"]) {
    if (l.slice(k, k + prefixo.length).toLowerCase() === prefixo) {
      k += prefixo.length;
      while (k < l.length && ehEspaco(l[k])) k++;
      break;
    }
  }
  const ini = k;
  const c0 = l.charCodeAt(k);
  if (!((c0 >= 65 && c0 <= 90) || (c0 >= 97 && c0 <= 122) || c0 === 95)) return -1;
  while (k < l.length) {
    const c = l.charCodeAt(k);
    if ((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95) k++;
    else break;
  }
  if (k === ini) return -1;
  while (k < l.length && ehEspaco(l[k])) k++;
  return l[k] === "=" ? k : -1;
}

/** Um valor `usuario:senha` (sem esquema, sem barra: `C:\x` e `localhost:5432/db` não são). */
function senhaDoUsuarioSenha(v: string): number {
  const dois = v.indexOf(":");
  if (dois < 2 || dois > 64) return -1;
  const usuario = v.slice(0, dois);
  const senha = v.slice(dois + 1);
  if (senha.length < 6 || /^\d+$/.test(senha)) return -1;
  for (const ch of usuario) if (ch === " " || ch === "\t" || ch === "@" || ch === "/" || ch === "\\") return -1;
  for (const ch of senha) if (ch === " " || ch === "\t" || ch === "@" || ch === "/" || ch === "\\" || ch === ":") return -1;
  return dois + 1;
}

/** Em cada linha `NOME=usuario:senha`, a senha some (`GOWA_BASIC_AUTH=admin:[segredo]` mesmo sem o nome dizer). */
function mascararUsuarioSenha(s: string): string {
  if (!s.includes("=") || !s.includes(":")) return s;
  return s
    .split("\n")
    .map((linha) => {
      const eq = igualDaVariavel(linha);
      if (eq === -1) return linha;
      const cr = linha.endsWith("\r") ? "\r" : "";
      const corpo = cr ? linha.slice(0, -1) : linha;
      let vIni = eq + 1;
      while (vIni < corpo.length && ehEspaco(corpo[vIni])) vIni++;
      let v = corpo.slice(vIni);
      const aspa = v[0] === '"' || v[0] === "'" ? v[0] : "";
      if (aspa && v.endsWith(aspa) && v.length >= 2) v = v.slice(1, -1);
      const s0 = senhaDoUsuarioSenha(v.trim());
      if (s0 === -1) return linha;
      return `${corpo.slice(0, vIni)}${aspa}${v.trim().slice(0, s0)}${SEGREDO}${aspa}${cr}`;
    })
    .join("\n");
}

/**
 * Leitura de arquivo de ambiente: o valor de TODA linha `NOME=valor` some,
 * qualquer que seja o nome. O nome fica (o dono vê quais chaves existem).
 * Vale também com número de linha na frente (`cat -n`, `Select-String`).
 */
export function mascararArquivoDeAmbiente(s: string): string {
  if (!s.includes("=")) return s;
  return s
    .split("\n")
    .map((linha) => {
      const eq = linha.indexOf("=");
      if (eq <= 0) return linha;
      let k = eq - 1;
      while (k >= 0 && ehEspaco(linha[k])) k--;
      if (k < 0 || !ehCharDeNome(linha.charCodeAt(k))) return linha;
      const cr = linha.endsWith("\r") ? "\r" : "";
      const resto = (cr ? linha.slice(0, -1) : linha).slice(eq + 1);
      if (!resto.trim() || resto.trim() === SEGREDO) return linha;
      return `${linha.slice(0, eq + 1)}${ehEspaco(resto[0]) ? " " : ""}${SEGREDO}${cr}`;
    })
    .join("\n");
}

export interface OpcoesDaMascara {
  /** o comando leu um arquivo de ambiente (`.env*`) ou outro protegido: máscara total dos valores */
  arquivoDeAmbiente?: boolean;
}

export function mascararSegredos(texto: string, valores: readonly string[] = [], opts: OpcoesDaMascara = {}): string {
  let s = texto;
  for (const v of valores) if (v && v.length >= 8) s = s.split(v).join(SEGREDO);
  s = mascararPem(s);
  for (const p of PADROES) s = s.replace(p, SEGREDO);
  // o usuário não tem ":" (a classe dele exclui), então o primeiro ":" depois do "://" separa a senha
  s = s.replace(SENHA_NO_ENDERECO, (m) => `${m.slice(0, m.indexOf(":", m.indexOf("://") + 3) + 1)}${SEGREDO}@`);
  s = s.replace(ESQUEMA_DE_AUTORIZACAO, (m, esquema: string, espaco: string, token: string) =>
    // "Basic configuration" é prosa; o Basic de verdade é base64, que quase sempre tem dígito, + / ou =
    esquema.toLowerCase() === "basic" && !/[0-9+/=]/.test(token) ? m : `${esquema}${espaco}${SEGREDO}`,
  );
  s = mascararChaveValor(s);
  s = mascararUsuarioSenha(s);
  if (opts.arquivoDeAmbiente) s = mascararArquivoDeAmbiente(s);
  return s;
}

/**
 * O comando, pelo TEXTO, parece ler um arquivo de ambiente? (`.env`, `ENV~1`,
 * `.en*`). É a reserva de quando as mãos não disseram o caminho real; o
 * caminho real (`caminhos_reais` dos fatos) é conferido em `terminal/risco.ts`.
 */
export function pareceLerArquivoDeAmbiente(comando: string): boolean {
  const c = comando.toLowerCase();
  return c.includes(".env") || /env~\d/.test(c) || /\.en[*?[]/.test(c) || /\.e[*?]/.test(c) || /[*?]env\b/.test(c) || c.includes(".mcp.json");
}

/** Mascara ANTES de cortar: o corte poderia partir um segredo no meio, e a metade escaparia da máscara. */
export function saidaParaOModelo(texto: string, max: number, valores: readonly string[] = segredosDoAmbiente(), opts: OpcoesDaMascara = {}): string {
  return cabecaECauda(mascararSegredos(texto, valores, opts), max);
}

/**
 * Corta o texto em `janela` caracteres ANTES de mascarar, sem deixar meio
 * token no fim: o pedaço depois do último separador (espaço, aspas, vírgula)
 * é jogado fora, porque pode ser o começo de um segredo que a máscara não
 * reconheceria pela metade. Para quem só guarda uma linha (a trilha).
 */
export function cortarSemPartirToken(texto: string, janela: number): string {
  if (texto.length <= janela) return texto;
  const corte = texto.slice(0, janela);
  for (let k = corte.length - 1; k >= 0; k--) {
    const c = corte.charCodeAt(k);
    if (terminaValor(c)) return corte.slice(0, k + 1);
  }
  return "";
}
