import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SETTING_DEFS } from "../settings/defs";
import { SEMPRE_NEGADOS } from "../maos/pastas";
import { riscoDoComando, tocaArquivoProtegido, type ConfigDoRisco, type FatosDoComando } from "./risco";

/**
 * O CLASSIFICADOR DE COMANDO (PRD A3) contra os FATOS REAIS do parser.
 *
 * Os fatos de `__fixtures__/fatos-risco.json` saem do apps/maos rodando o AST
 * oficial do PowerShell (Windows PowerShell 5.1 nesta máquina) e o
 * tree-sitter-bash sobre `apps/maos/tests/casos_risco.json`
 * (`apps/maos/scripts/gerar_fatos_risco.py`; o pytest reprova se ficarem
 * velhos). Então cada caso prova o par inteiro: o que o parser enxerga E o
 * que a regra decide. Inclui os truques do PRD: `;` depois de espaços, crase
 * de continuação, `$()`, `cmd /c`, alias, `..`, `&&` com comando liberado na
 * frente, WMI, `iex`, `-EncodedCommand`, RunAs, UNC, Registro, apagar
 * recursivo e baixar-e-executar.
 */

interface Caso {
  comando: string;
  shell: string;
  esperado: "leitura" | "efeito_externo" | "perigoso";
  nota?: string;
  fatos: FatosDoComando;
}

const casos = JSON.parse(readFileSync(new URL("./__fixtures__/fatos-risco.json", import.meta.url), "utf-8")) as Caso[];

const cfg: ConfigDoRisco = {
  comandosDeLeitura: SETTING_DEFS["terminal.comandosDeLeitura"].default,
  pastas: SETTING_DEFS["terminal.pastas"].default,
  pasta: "C:\\Users\\dono\\Documents\\github\\orbita",
  negados: [...SEMPRE_NEGADOS, ...SETTING_DEFS["arquivos.negados"].default],
  home: "C:\\Users\\dono",
};

describe("riscoDoComando, com os fatos do parser de verdade", () => {
  it("tem pelo menos 60 casos, das duas linguagens e dos três riscos", () => {
    expect(casos.length).toBeGreaterThanOrEqual(60);
    expect(new Set(casos.map((c) => c.shell))).toEqual(new Set(["powershell", "bash"]));
    expect(new Set(casos.map((c) => c.esperado))).toEqual(new Set(["leitura", "efeito_externo", "perigoso"]));
  });

  it.each(casos.map((c) => [c.comando.replace(/\n/g, "⏎"), c] as const))("%s", (_n, c) => {
    const r = riscoDoComando(c.fatos, cfg);
    expect(r.risco, `${c.comando} (${c.nota ?? ""}): ${r.motivos.join("; ")}`).toBe(c.esperado);
    if (r.risco !== "leitura") expect(r.motivos.length).toBeGreaterThan(0);
  });
});

const fatos = (comandos: FatosDoComando["comandos"], extra: Partial<FatosDoComando> = {}): FatosDoComando => ({
  shell: "powershell", parse_ok: true, comandos, redirecionamentos: [], substituicoes: [], metodos: [], tipos: [], operadores: [], atribuicoes: 0, ...extra,
});
const cmd = (nome: string, args: string[] = [], extra: Partial<FatosDoComando["comandos"][number]> = {}) => ({ nome, nome_resolvido: nome, dinamico: false, args, args_dinamicos: false, invocacao: null, ...extra });

describe("riscoDoComando, regras", () => {
  it("a lista é que libera: o dono acrescenta \"pnpm test\" e ele vira leitura; \"pnpm install\" não", () => {
    const c = { ...cfg, comandosDeLeitura: [...cfg.comandosDeLeitura, "pnpm test"] };
    expect(riscoDoComando(fatos([cmd("pnpm", ["test"])]), c).risco).toBe("leitura");
    expect(riscoDoComando(fatos([cmd("pnpm", ["install"])]), c).risco).toBe("efeito_externo");
    expect(riscoDoComando(fatos([cmd("pnpm", ["test"])]), cfg).risco).toBe("efeito_externo");
  });

  it("caminho para o binário nunca casa com a lista (um git.exe falso na pasta)", () => {
    expect(riscoDoComando(fatos([cmd(".\\git.exe", ["status"])]), cfg).risco).toBe("efeito_externo");
    expect(riscoDoComando(fatos([cmd("C:\\x\\git", ["status"])]), cfg).risco).toBe("efeito_externo");
  });

  it("pasta do comando fora das pastas liberadas é perigoso, mesmo com git status", () => {
    expect(riscoDoComando(fatos([cmd("git", ["status"])]), { ...cfg, pasta: "C:\\Windows" }).risco).toBe("perigoso");
    // "github-falso" não está dentro de "github"
    expect(riscoDoComando(fatos([cmd("git", ["status"])]), { ...cfg, pasta: "C:\\Users\\dono\\Documents\\github-falso" }).risco).toBe("perigoso");
  });

  it("parse falho é perigoso e diz por quê", () => {
    const r = riscoDoComando(fatos([], { parse_ok: false, erros: ["token inesperado"] }), cfg);
    expect(r).toEqual({ risco: "perigoso", motivos: [expect.stringMatching(/não deu para analisar.*token inesperado/)] });
  });

  it("a lista vazia não libera nada", () => {
    expect(riscoDoComando(fatos([cmd("git", ["status"])]), { ...cfg, comandosDeLeitura: [] }).risco).toBe("efeito_externo");
  });

  it("parâmetro abreviado do PowerShell (-Rec) também é recursivo", () => {
    expect(riscoDoComando(fatos([cmd("Remove-Item", ["-Rec", "x"])]), cfg).risco).toBe("perigoso");
    expect(riscoDoComando(fatos([cmd("Remove-Item", ["-Recurse:$true", "x"])]), cfg).risco).toBe("perigoso");
    expect(riscoDoComando(fatos([cmd("Remove-Item", ["-Force", "x"])]), cfg).risco).toBe("efeito_externo");
  });
});

describe("riscoDoComando, o caminho real e os truques de caminho (G1 da auditoria)", () => {
  const orbita = String.raw`C:\Users\dono\Documents\github\orbita`;

  it("o caminho real manda: um nome inocente que, no disco, é o .env deixa de ser leitura", () => {
    const f = fatos([cmd("Get-Content", ["notas"])], { caminhos_reais: [{ arg: "notas", real: String.raw`${orbita}\.env` }] });
    const r = riscoDoComando(f, cfg);
    expect(r.risco).toBe("efeito_externo");
    expect(r.motivos.join(" ")).toContain("arquivo protegido");
    expect(tocaArquivoProtegido(f, cfg)).toBe(true);
  });

  it("junção que sai das pastas liberadas também sobe, e diz para onde aponta", () => {
    const real = String.raw`C:\Windows\win.ini`;
    const r = riscoDoComando(fatos([cmd("Get-Content", [String.raw`atalho\x.txt`])], { caminhos_reais: [{ arg: String.raw`atalho\x.txt`, real }] }), cfg);
    expect(r.risco).toBe("efeito_externo");
    expect(r.motivos.join(" ")).toContain(real);
  });

  it("controle: o mesmo comando com o real dentro da pasta continua leitura, e sem os reais (mãos antigas) vale o texto", () => {
    expect(riscoDoComando(fatos([cmd("Get-Content", ["notas.txt"])], { caminhos_reais: [{ arg: "notas.txt", real: String.raw`${orbita}\notas.txt` }] }), cfg).risco).toBe("leitura");
    expect(riscoDoComando(fatos([cmd("Get-Content", ["notas.txt"])]), cfg).risco).toBe("leitura");
    expect(tocaArquivoProtegido(fatos([cmd("Get-Content", ["notas.txt"])]), cfg)).toBe(false);
  });

  it("o texto já basta para a máscara total: argumento ou redirecionamento que é um negado", () => {
    expect(tocaArquivoProtegido(fatos([cmd("cat", [".env.local"])]), cfg)).toBe(true);
    expect(tocaArquivoProtegido(fatos([cmd("cat", [])], { redirecionamentos: [{ tipo: "entrada", alvo: "id_rsa.key" }] }), cfg)).toBe(true);
  });

  it.each([
    ["ENV~1", "efeito_externo"],
    [String.raw`docs\PROGRA~1\x`, "efeito_externo"],
    [".en*", "efeito_externo"],
    ["*env", "efeito_externo"],
    [".en?", "efeito_externo"],
    ["[.]env", "efeito_externo"],
    [String.raw`%APPDATA%\x`, "efeito_externo"],
    [String.raw`$env:USERPROFILE\x`, "efeito_externo"],
    ["env:PATH", "efeito_externo"],
    [".env::$DATA", "perigoso"],
    ["README.md:oculto", "perigoso"],
    [String.raw`\\?\C:\x`, "perigoso"],
    [String.raw`\\.\PhysicalDrive0`, "perigoso"],
    ["//?/C:/x", "perigoso"],
  ])("Get-Content %s: %s", (arg, esperado) => {
    const r = riscoDoComando(fatos([cmd("Get-Content", [arg])]), cfg);
    expect(r.risco, r.motivos.join("; ")).toBe(esperado);
  });

  it("no git, HEAD~1 é revisão (leitura) e HEAD:.env lê o arquivo do histórico (não é)", () => {
    expect(riscoDoComando(fatos([cmd("git", ["diff", "HEAD~1"])]), cfg).risco).toBe("leitura");
    expect(riscoDoComando(fatos([cmd("git", ["show", "HEAD:.env"])]), cfg).risco).toBe("efeito_externo");
    expect(riscoDoComando(fatos([cmd("git", ["log", "--format=%h: %s"])]), cfg).risco).toBe("leitura");
  });
});
