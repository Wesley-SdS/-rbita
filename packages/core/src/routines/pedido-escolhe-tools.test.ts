import { describe, expect, it, vi } from "vitest";

/**
 * Regra e rotina escolhem as tools PELO PEDIDO. Com consulta vazia, a regra do
 * trânsito das 5h rodou sem a tool `rota` e respondeu "não tenho uma
 * ferramenta de rota/trânsito" (28/09/2026).
 */
vi.mock("@orbita/db", () => ({ db: {} }));
const { listRegisteredTools, selectRelevant } = await import("../tools/registry");
await import("../tools/domains/mundo");
await import("../tools/domains/financas");
await import("../tools/domains/tempo");
await import("../tools/domains/memoria");

describe("seleção de tools com o pedido da regra", () => {
  it("o pedido do trânsito escolhe `rota`, mesmo com teto pequeno", () => {
    const pedido = 'Use a ferramenta rota de casa até "Adalink" (de carro). Responda numa mensagem curta de bom dia para o WhatsApp: quanto tempo leva, a distância, e se o tempo é com o trânsito de agora ou sem trânsito.';
    const nomes = selectRelevant(listRegisteredTools(), pedido, 8).map((d) => d.name);
    expect(nomes).toContain("rota");
  });
});
