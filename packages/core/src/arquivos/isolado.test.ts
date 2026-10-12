import { afterAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * B5, a classe e não só aquele parser: a leitura de arquivo de terceiro roda
 * numa worker thread com teto de tempo real. Um parser preso (aqui, uma thread
 * que gira a CPU para sempre) não para o laço de quem pediu, e o teto mata a
 * thread e devolve "não lido". O controle é a thread de verdade lendo um ODT
 * de verdade.
 */

const cfg: Record<string, unknown> = { "anexos.tetoDaLeituraSeg": 1 };
vi.mock("../settings", async () => {
  const { SETTING_DEFS } = await import("../settings/defs");
  const valor = (k: string) => (k in cfg ? cfg[k] : (SETTING_DEFS as Record<string, { default: unknown }>)[k]!.default);
  return { settings: { get: async (k: string) => valor(k), getMany: async (ks: string[]) => Object.fromEntries(ks.map((k) => [k, valor(k)])) } };
});
vi.mock("@orbita/db", () => ({ db: {} }));

// a thread de verdade lê a config sozinha (sem os mocks daqui): sem banco, valem os defaults
process.env.DATABASE_URL ||= "postgres://ninguem:nada@127.0.0.1:1/nenhum";

const { extrairIsolado, _isolamentoEmTeste } = await import("./isolado");
// o extrator carregado antes de medir: compilar o módulo na primeira chamada não é o laço parado que se procura aqui
await import("./extrair");
await import("./detectar");

const FX = join(__dirname, "__fixtures__");

/** O maior intervalo entre dois tiques de um relógio de 20 ms enquanto `fn` roda: o laço parado aparece aqui. */
async function maiorPausa<T>(fn: () => Promise<T>): Promise<{ r: T; pausaMs: number; ms: number }> {
  let ultimo = Date.now();
  let pausaMs = 0;
  const relogio = setInterval(() => {
    pausaMs = Math.max(pausaMs, Date.now() - ultimo);
    ultimo = Date.now();
  }, 20);
  const inicio = Date.now();
  try {
    const r = await fn();
    return { r, pausaMs, ms: Date.now() - inicio };
  } finally {
    clearInterval(relogio);
  }
}

afterAll(async () => {
  await _isolamentoEmTeste(false);
});

describe("leitura isolada com teto (B5)", () => {
  it("parser preso: o laço continua girando e o teto mata a thread, devolvendo não lido", async () => {
    await _isolamentoEmTeste(true, new URL("./__fixtures__/trabalhador-preso.mjs", import.meta.url));
    const m = await maiorPausa(() => extrairIsolado(readFileSync(join(FX, "contrato.odt")), { nome: "contrato.odt" }));
    expect(m.r.lido).toBe(false);
    expect(m.r.resumo).toMatch(/passou de 1 s e foi interrompida/);
    expect(m.r.sha256).toMatch(/^[0-9a-f]{64}$/);
    // o teto é de 1 s: a resposta vem perto disso, e não nunca
    expect(m.ms).toBeLessThan(5000);
    // o laço de quem pediu nunca parou (com o parser no laço principal, a pausa seria o tempo todo)
    expect(m.pausaMs).toBeLessThan(400);
  }, 30_000);

  it("leitor que infla além da conta: a thread morre no teto de memória, o processo segue, e o arquivo sai não lido (I5)", async () => {
    cfg["anexos.tetoDaLeituraSeg"] = 60;
    cfg["anexos.memoriaDaLeituraMb"] = 64;
    await _isolamentoEmTeste(true, new URL("./__fixtures__/trabalhador-guloso.mjs", import.meta.url));
    try {
      const r = await extrairIsolado(readFileSync(join(FX, "contrato.odt")), { nome: "contrato.odt" });
      expect(r.lido).toBe(false);
      expect(r.resumo).toMatch(/passou de 64 MB de memória/);
      expect(r.avisos.join(" ")).toMatch(/Memória de uma leitura/);
      // este processo continua de pé (sem o teto, o OOM da worker derrubaria o vitest inteiro)
      expect(process.memoryUsage().heapUsed).toBeGreaterThan(0);
    } finally {
      delete cfg["anexos.memoriaDaLeituraMb"];
    }
  }, 60_000);

  it("controle: a thread de verdade lê o ODT, e o pedido de parar continua valendo", async () => {
    cfg["anexos.tetoDaLeituraSeg"] = 120;
    await _isolamentoEmTeste(true);
    const odt = readFileSync(join(FX, "contrato.odt"));
    const r = await extrairIsolado(odt, { nome: "contrato.odt" });
    expect(r.lido).toBe(true);
    expect(r.tipo.ext).toBe("odt");
    expect(r.texto.length).toBeGreaterThan(20);
    // quem pediu já tinha desistido: a leitura para no primeiro ponto seguro, dentro da thread
    const parar = new AbortController();
    parar.abort();
    await expect(extrairIsolado(odt, { nome: "contrato.odt", sinal: parar.signal })).rejects.toThrow("Leitura interrompida.");
  }, 120_000);
});
