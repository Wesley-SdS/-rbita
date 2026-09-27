import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * QUEM ATENDE AS TAREFAS DA CASA (rotina, regra, memória, resumo, extrato).
 *
 * Relatado pelo dono em 27/09/2026: com "assinatura primeiro" escolhido em
 * Ajustes, o resumo de reunião levou 123 s e a extração de memória 87 s, os
 * dois no `local/qwen2.5:7b`, afogando a máquina.
 *
 * A causa não era a ordenação (essa estava certa, ver packages/llm casa.test),
 * era o PONTO DE ENTRADA: sem um modelo pedido, o código usava o MODELO RESERVA
 * como se fosse escolha, e o reserva é o bootstrap local. Como `buildModelChain`
 * põe o pedido em primeiro lugar, a ordem do dono nunca chegava a ser lida.
 *
 * `routines.model` e `memory.extractModel` nascem VAZIOS, então este era o
 * caminho de todo dia, não um caso de borda.
 */
const buildModelChain = vi.fn<(pedido: string) => string[]>();
const cadeiaDaCasa = vi.fn<() => string[]>();
const fallbackModelKey = vi.fn<() => Promise<string>>();

vi.mock("@orbita/llm", () => ({
  buildModelChain: (p: string) => buildModelChain(p),
  cadeiaDaCasa: () => cadeiaDaCasa(),
  fallbackModelKey: () => fallbackModelKey(),
  recordProviderResult: vi.fn(),
  resolveModel: (k: string) => ({ modelId: k }),
  statusDoErro: () => undefined,
}));
vi.mock("../usage/registrar", () => ({ registrarUso: vi.fn(), FLUXO: {} }));
vi.mock("../observability/logger", () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const { candidatosDaCasa } = await import("./gerar");

beforeEach(() => {
  buildModelChain.mockReset();
  cadeiaDaCasa.mockReset();
  fallbackModelKey.mockReset();
  fallbackModelKey.mockResolvedValue("local/qwen2.5:7b");
  buildModelChain.mockImplementation((pedido) => [pedido, "gateway/outro"]);
});

describe("candidatosDaCasa", () => {
  it("SEM modelo pedido segue a ordem do dono, não o reserva local", async () => {
    // é a correção: antes a rotina abria no local/qwen2.5:7b
    cadeiaDaCasa.mockReturnValue(["claude/claude-opus-5", "gateway/gpt-6-sol", "local/qwen2.5:7b"]);
    expect(await candidatosDaCasa()).toEqual(["claude/claude-opus-5", "gateway/gpt-6-sol", "local/qwen2.5:7b"]);
    expect(fallbackModelKey).not.toHaveBeenCalled();
  });

  it("config vazia conta como SEM modelo pedido", async () => {
    // `routines.model` e `memory.extractModel` nascem "" e chegam aqui assim
    cadeiaDaCasa.mockReturnValue(["claude/claude-opus-5"]);
    expect(await candidatosDaCasa("")).toEqual(["claude/claude-opus-5"]);
    expect(await candidatosDaCasa("   ")).toEqual(["claude/claude-opus-5"]);
    expect(buildModelChain).not.toHaveBeenCalled();
  });

  it("modelo pedido por nome vira o PRIMEIRO, com os outros de reserva", async () => {
    // quem configurou um modelo para as rotinas continua mandando
    cadeiaDaCasa.mockReturnValue(["claude/claude-opus-5"]);
    expect(await candidatosDaCasa("local/qwen2.5:7b")).toEqual(["local/qwen2.5:7b", "gateway/outro"]);
    expect(cadeiaDaCasa).not.toHaveBeenCalled();
  });

  it("descoberta vazia (primeiro boot) cai no reserva", async () => {
    // sem nenhum provedor ter respondido a lista ainda, o reserva é o que há
    cadeiaDaCasa.mockReturnValue([]);
    expect(await candidatosDaCasa()).toEqual(["local/qwen2.5:7b", "gateway/outro"]);
    expect(fallbackModelKey).toHaveBeenCalled();
  });

  it("sem cadeia e sem reserva devolve vazio, para quem chama reclamar", async () => {
    cadeiaDaCasa.mockReturnValue([]);
    buildModelChain.mockReturnValue([]);
    expect(await candidatosDaCasa()).toEqual([]);
  });
});
