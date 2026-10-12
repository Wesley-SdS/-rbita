import { describe, expect, it } from "vitest";
import { cortarSemPartirToken, mascararArquivoDeAmbiente, mascararSegredos, nomeDeSegredo, pareceLerArquivoDeAmbiente, saidaParaOModelo, segredosDoAmbiente } from "./saida";
import { mascararEnderecos, mascararNaTrilha } from "../controle/segredos";

/**
 * A MÁSCARA DE SEGREDO da saída do terminal e da trilha.
 *
 * G2 da auditoria de 11/10/2026: a regex de `nome=valor` tinha a forma
 * `[A-Za-z0-9_.-]*(secret|…)[A-Za-z0-9_.-]*` e a de endereço começava em
 * `\b[a-z][a-z0-9+.-]*`. Em 40 mil caracteres `a.a.a…` cada posição tentava
 * de novo a corrida inteira: 13,7 s e 5,3 s com o laço de eventos parado, e a
 * máscara roda duas vezes por comando (saída para o modelo e trilha). Aqui o
 * texto patológico de 40 mil e de 400 mil caracteres tem de sair em menos de
 * 1 s, com um relógio de 10 ms provando que o laço continua girando.
 *
 * G3: segredo de nome genérico (`GOWA_BASIC_AUTH`, `usuario:senha`, JWT,
 * `.env` de outro projeto) e, como controle, texto normal que NÃO pode virar
 * `[segredo]` à toa (o `git log` com "Author:", um PATH, uma porta).
 */

async function medir<T>(fn: () => T): Promise<{ ms: number; maiorPausaMs: number; r: T }> {
  let ultimo = Date.now();
  let maiorPausaMs = 0;
  const relogio = setInterval(() => {
    const agora = Date.now();
    maiorPausaMs = Math.max(maiorPausaMs, agora - ultimo);
    ultimo = agora;
  }, 10);
  // deixa o relógio dar o primeiro tique antes de medir
  await new Promise((ok) => setTimeout(ok, 30));
  const inicio = Date.now();
  try {
    const r = fn();
    await new Promise((ok) => setTimeout(ok, 30));
    return { ms: Date.now() - inicio - 30, maiorPausaMs: Math.max(maiorPausaMs, Date.now() - ultimo), r };
  } finally {
    clearInterval(relogio);
  }
}

/** Repete `pedaco` até `tamanho` caracteres. */
const patologico = (pedaco: string, tamanho: number) => pedaco.repeat(Math.ceil(tamanho / pedaco.length)).slice(0, tamanho);

/** Os textos que derrubavam (ou poderiam derrubar) cada regex: a corrida que falha no fim, repetida. */
const PEDACOS = [
  "a.", "a-", "a_", "token.", "secret-", "password_", "sk-", "ghp_", "xoxb-", "eyJabcdefghijk.", "AKIA", "a=", "a:", "token=\"", "token: '",
  "-----BEGIN RSA PRIVATE KEY-----\n", "https://a:", "postgres://u:", "http://", "Bearer ", "Basic ", "x=admin:", "auth_", "sessionId", "\"password\" :",
  "[x]::", "%%", "$env:", "a\n=b",
];

describe("máscara de segredo: tempo linear (G2)", () => {
  for (const tamanho of [40_000, 400_000]) {
    it.each(PEDACOS.map((p) => [JSON.stringify(p), p] as const))(`saída do terminal, ${tamanho} caracteres de %s`, async (_n, p) => {
      const t = patologico(p, tamanho);
      const m = await medir(() => saidaParaOModelo(t, 30_000, [], { arquivoDeAmbiente: true }));
      expect(m.ms, `${p}: ${m.ms} ms`).toBeLessThan(1000);
      expect(m.maiorPausaMs).toBeLessThan(1000);
    });

    it.each(PEDACOS.map((p) => [JSON.stringify(p), p] as const))(`trilha, ${tamanho} caracteres de %s`, async (_n, p) => {
      const t = patologico(p, tamanho);
      const m = await medir(() => mascararNaTrilha(t, []));
      expect(m.ms, `${p}: ${m.ms} ms`).toBeLessThan(1000);
      expect(m.maiorPausaMs).toBeLessThan(1000);
    });
  }

  it("o caso medido na auditoria: 40 mil de a.a.a… pela máscara inteira das duas pontas", async () => {
    const t = "a.".repeat(20_000);
    const m = await medir(() => [saidaParaOModelo(t, 30_000, []), mascararNaTrilha(t, [])]);
    expect(m.ms).toBeLessThan(1000);
    // e a saída continua a mesma: não havia segredo nenhum
    expect(m.r[1]).toBe(t);
  });
});

describe("máscara de segredo: o que some (G3)", () => {
  const m = (t: string, opts = {}) => mascararSegredos(t, [], opts);

  it("formatos de token conhecidos", () => {
    const tokens = [
      "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789",
      "sk-proj-abcdefghijklmnopqrstuvwxyz0123",
      "ghp_abcdefghijklmnopqrstuvwxyz0123456789",
      "github_pat_11ABCDEFG0abcdefghijklmnopqrstuvwxyz0123456789",
      "glpat-abcdefghij0123456789",
      "xoxb-1234567890-abcdefghij",
      "AKIAIOSFODNN7EXAMPLE",
      "AIzaSyA-abcdefghijklmnopqrstuvwxyz012345",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
    ];
    for (const t of tokens) {
      const r = m(`saiu: ${t} fim`);
      expect(r, t).not.toContain(t.slice(4, 20));
      expect(r).toContain("[segredo]");
      expect(r).toContain("fim");
    }
  });

  it("chave privada PEM, inteira e cortada (sem o END)", () => {
    const pem = "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\nQUJDREVGR0g=\n-----END OPENSSH PRIVATE KEY-----";
    expect(m(`antes\n${pem}\ndepois`)).toBe("antes\n[segredo]\ndepois");
    expect(m(`antes\n${pem.slice(0, 60)}`)).toBe("antes\n[segredo]");
  });

  it("nome com segredo: = : e JSON, com e sem aspas, e o Bearer", () => {
    expect(m("API_KEY=abcdef123456")).toBe("API_KEY=[segredo]");
    expect(m('client_secret: "um valor com espaco"')).toBe('client_secret: "[segredo]"');
    expect(m('{"password": "hunter22", "user": "wesley"}')).toBe('{"password": "[segredo]", "user": "wesley"}');
    expect(m("senha = minhasenha123")).toBe("senha = [segredo]");
    const h = m("Authorization: Bearer abc.def-ghi_jkl012345");
    expect(h).not.toContain("abc.def");
    expect(h).toContain("Authorization: Bearer [segredo]");
    expect(m("curl -H 'X-Auth-Token: 0123456789abcdef' x")).not.toContain("0123456789abcdef");
  });

  it("nomes genéricos que a versão anterior deixava passar: AUTH, COOKIE, SESSION, DSN, CONN, CREDENTIAL", () => {
    for (const linha of [
      "GOWA_BASIC_AUTH=admin:SenhaFalsa123",
      "SESSION_ID=abcdef1234567",
      "Cookie: sessao=abcdefgh12345",
      "SENTRY_DSN=https://abcdef123@o1.ingest.sentry.io/42",
      "DB_CONN=Server=db;Password=senhaforte",
      "GOOGLE_CREDENTIALS=/home/x/cred.json",
      "basicAuth: usuario123",
    ]) {
      const r = m(linha);
      expect(r, linha).toContain("[segredo]");
    }
    expect(m("GOWA_BASIC_AUTH=admin:SenhaFalsa123")).not.toContain("SenhaFalsa123");
  });

  it("usuario:senha no valor de variável, mesmo com nome que não diz nada", () => {
    expect(m("PROXY=admin:SenhaFalsa123")).toBe("PROXY=admin:[segredo]");
    expect(m('export UPSTREAM="ops:Outra.Senha99"')).toBe('export UPSTREAM="ops:[segredo]"');
    expect(m("git clone https://wesley:ghp_abcdefghijklmnopqrstuvwxyz0123456789@github.com/x/y")).not.toContain("ghp_abc");
    expect(m("redis://default:SenhaRedis123@localhost:6379")).toBe("redis://default:[segredo]@localhost:6379");
  });

  it(".env lido pelo terminal: o valor de TODA linha some, o nome fica", () => {
    const env = [
      "# Adalink", "ALLOWED_EMAILS=a@b.com,c@d.com", "NEXT_PUBLIC_URL=http://localhost:3000", "PORTA = 3010", "VAZIO=", "", "  1\tOUTRO=valor-qualquer\r",
    ].join("\n");
    expect(m(env, { arquivoDeAmbiente: true })).toBe(
      ["# Adalink", "ALLOWED_EMAILS=[segredo]", "NEXT_PUBLIC_URL=[segredo]", "PORTA = [segredo]", "VAZIO=", "", "  1\tOUTRO=[segredo]\r"].join("\n"),
    );
    // sem o modo de arquivo de ambiente, nome genérico continua legível (o controle da regra acima)
    expect(m("ALLOWED_EMAILS=a@b.com,c@d.com")).toBe("ALLOWED_EMAILS=a@b.com,c@d.com");
    expect(mascararArquivoDeAmbiente("sem igual nenhum")).toBe("sem igual nenhum");
  });

  it("o valor de um segredo do ambiente some em qualquer lugar do texto", () => {
    expect(m("o valor abcd1234efgh5678 apareceu")).toContain("abcd1234efgh5678");
    expect(mascararSegredos("o valor abcd1234efgh5678 apareceu", ["abcd1234efgh5678"])).toBe("o valor [segredo] apareceu");
    expect(segredosDoAmbiente({ GOWA_BASIC_AUTH: "admin:SenhaFalsa123", ALLOWED_EMAILS: "a@b.com,c@d.com", PATH: "C:\\Windows\\System32" })).toEqual(["admin:SenhaFalsa123", "a@b.com,c@d.com"]);
  });

  it("o comando que lê arquivo de ambiente, pelo texto", () => {
    for (const c of ["Get-Content .env", "cat .env.local", "type ENV~1", "cat .en*", "Get-Content .e?v", "Get-Content *env", "cat .mcp.json"]) expect(pareceLerArquivoDeAmbiente(c), c).toBe(true);
    for (const c of ["git status", "Get-Content README.md", "node --version", "cat environment.md"]) expect(pareceLerArquivoDeAmbiente(c), c).toBe(false);
  });
});

describe("máscara de segredo: o que NÃO pode sumir (controle)", () => {
  const m = (t: string) => mascararSegredos(t, []);

  it("saída comum continua igual", () => {
    for (const t of [
      "commit 6fd986e\nAuthor: Wesley Santos <wesley@exemplo.com>\nDate:   Sun Oct 11 10:00:00 2026\n\n    fix: corrige token expirado no login",
      "PATH=C:\\Windows\\System32;C:\\Program Files\\nodejs",
      "HOST=localhost:5432",
      "HORA=12:30:00",
      "Basic configuration done",
      "[System.IO.File]::ReadAllText('x')",
      "connected: true, disconnect: false",
      "Test Files  3 passed (3)\n     Tests  42 passed (42)",
      "https://jira.com/browse/TECH-1?filtro=meus",
      "author: alguem-que-escreve",
    ]) expect(m(t), t).toBe(t);
  });

  it("nomeDeSegredo separa palavra inteira de pedaço", () => {
    for (const n of ["GOWA_BASIC_AUTH", "sessionId", "basicAuth", "DB_CONN", "x-auth-token", "Authorization", "ApiKey", "my.password"]) expect(nomeDeSegredo(n), n).toBe(true);
    for (const n of ["Author", "authors", "disconnect", "connected", "passed", "Date"]) expect(nomeDeSegredo(n), n).toBe(false);
  });

  it("endereço sem senha nem parâmetro de segredo fica como era", () => {
    expect(mascararEnderecos("veja https://exemplo.com/a?b=1 e ftp://x.y/z")).toBe("veja https://exemplo.com/a?b=1 e ftp://x.y/z");
  });
});

describe("cortarSemPartirToken", () => {
  it("não deixa meio token no fim do corte", () => {
    expect(cortarSemPartirToken("curto", 100)).toBe("curto");
    expect(cortarSemPartirToken("abc def ghi_jkl_mno", 12)).toBe("abc def ");
    expect(cortarSemPartirToken("x".repeat(50), 10)).toBe("");
  });

  it("o começo de um token cortado pela janela não aparece na trilha", () => {
    const token = "sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789";
    const texto = `${"palavra ".repeat(249)}${token}`; // o token começa em 1.992 e atravessa a janela de 2.000
    const corte = cortarSemPartirToken(texto, 2000);
    expect(corte).not.toContain("sk-ant");
  });
});
