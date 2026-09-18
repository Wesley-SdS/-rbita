import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acompanharJob, enfileirar, type JobView } from "./jobs";

/**
 * O cliente da fila. O que importa: o ritmo do polling é do SERVIDOR
 * (`Retry-After`), falha passageira não abandona um trabalho que continua
 * rodando, e erro definitivo aparece em vez de sumir.
 */

const base = (over: Partial<JobView> = {}): JobView => ({
  id: "j1", tipo: "t", titulo: "t", status: "rodando",
  progresso: { feito: 0, total: 2, passo: null }, tentativas: 1, maxTentativas: 3, proximaTentativaEm: null,
  erro: null, resultado: null, cancelamentoPedido: false, criadoEm: "", atualizadoEm: "", iniciadoEm: null, finalizadoEm: null, ...over,
});

let respostas: (() => Response | Promise<Response>)[] = [];
const esperas: number[] = [];

beforeEach(() => {
  respostas = [];
  esperas.length = 0;
  vi.stubGlobal("fetch", vi.fn(async () => (respostas.shift() ?? (() => Response.json(base({ status: "feito" }))))()));
  // tempo simulado: registra quanto o cliente pediu para esperar, sem esperar
  vi.stubGlobal("setTimeout", ((fn: () => void, ms: number) => {
    esperas.push(ms);
    fn();
    return 0;
  }) as unknown as typeof setTimeout);
});
afterEach(() => vi.unstubAllGlobals());

describe("acompanhar um trabalho", () => {
  it("segue o Retry-After de cada resposta até terminar", async () => {
    respostas = [
      () => Response.json(base({ progresso: { feito: 1, total: 2, passo: "meio" } }), { headers: { "Retry-After": "4" } }),
      () => Response.json(base({ status: "feito", resultado: { ok: true } })),
    ];
    const vistos: string[] = [];
    const fim = await acompanharJob(base(), (j) => vistos.push(j.status));
    expect(fim.resultado).toEqual({ ok: true });
    expect(vistos).toEqual(["rodando", "feito"]);
    expect(esperas).toEqual([1000, 4000]);
  });

  it("falha passageira não abandona o trabalho: insiste e continua", async () => {
    respostas = [() => new Response("", { status: 502 }), () => Promise.reject(new TypeError("rede")), () => Response.json(base({ status: "feito" }))];
    const fim = await acompanharJob(base(), () => undefined);
    expect(fim.status).toBe("feito");
    // espera crescente depois de cada falha
    expect(esperas).toEqual([1000, 2000, 4000]);
  });

  it("depois de muitas falhas seguidas, avisa em vez de ficar calado", async () => {
    respostas = Array.from({ length: 10 }, () => () => new Response("", { status: 503 }));
    await expect(acompanharJob(base(), () => undefined, undefined, 3)).rejects.toThrow(/Perdi o contato/);
  });

  it("4xx é definitivo e traz a mensagem do servidor", async () => {
    respostas = [() => Response.json({ error: "Trabalho não encontrado" }, { status: 404 })];
    await expect(acompanharJob(base(), () => undefined)).rejects.toThrow("Trabalho não encontrado");
  });

  it("trabalho que já nasceu terminado não faz pedido nenhum", async () => {
    await acompanharJob(base({ status: "feito" }), () => undefined);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("enfileirar", () => {
  it("202 devolve o status", async () => {
    expect((await enfileirar(Response.json(base({ status: "pendente" }), { status: 202 }))).status).toBe("pendente");
  });
  it("erro de validação traz a mensagem, sem enfileirar", async () => {
    await expect(enfileirar(Response.json({ error: "Arquivo maior que o limite de 25 MB." }, { status: 413 }))).rejects.toThrow("25 MB");
  });
});
