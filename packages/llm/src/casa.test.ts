import { describe, expect, it } from "vitest";
import { ordenarAlternativas } from "./failover";
import type { ModelInfo } from "./catalog";

/**
 * O modelo que as tarefas DA CASA usam (resumo de reunião, extração de
 * memória, rotinas).
 *
 * Relatado pelo dono em 27/09/2026: ele tinha escolhido "assinatura primeiro" e
 * mesmo assim o resumo de reunião levou 123 s e a extração de memória 87 s, os
 * dois no `local/qwen2.5:7b`, afogando a máquina inteira.
 *
 * A causa: sem um modelo pedido, o código usava o MODELO RESERVA como se fosse
 * escolha, e o reserva é o bootstrap `local/qwen2.5:7b`. Como o
 * `buildModelChain` põe o modelo pedido em PRIMEIRO lugar, a ordem do dono
 * nunca chegava a ser consultada.
 *
 * A garantia que este arquivo trava é a ordenação: com "assinatura primeiro",
 * a assinatura fica na frente do local. `cadeiaDaCasa` é essa ordenação
 * aplicada ao catálogo descoberto.
 */
const m = (key: string, over: Partial<ModelInfo>): ModelInfo => ({
  key,
  provider: "gateway",
  id: key,
  label: key,
  tier: "medium",
  billing: "paid",
  costPer1k: 0,
  priceKnown: true,
  local: false,
  ...over,
});

const assinatura = m("claude/claude-opus-5", { provider: "claude", billing: "subscription" });
const localLento = m("local/qwen2.5:7b", { provider: "local", billing: "free", local: true, tier: "small" });
const pago = m("gateway/gpt-6-sol", { costPer1k: 0.01, tier: "large" });

describe("a ordem que as tarefas da casa seguem", () => {
  it("ASSINATURA primeiro deixa o local para trás", () => {
    // é a correção: antes a tarefa ia direto para o local, sem olhar isto
    const ordem = ordenarAlternativas([localLento, pago, assinatura], "assinatura_paga_local");
    expect(ordem[0]!.key).toBe("claude/claude-opus-5");
    expect(ordem.findIndex((x) => x.local)).toBe(ordem.length - 1);
  });

  it("quem prefere o local continua com o local", () => {
    // a correção não pode tirar a escolha de quem quer tudo em casa
    const ordem = ordenarAlternativas([pago, assinatura, localLento], "local_primeiro");
    expect(ordem[0]!.key).toBe("local/qwen2.5:7b");
  });

  it("a cadeia INTEIRA sai ordenada, não só o primeiro", () => {
    // é o que dá failover de verdade: se a assinatura falhar, a próxima é a
    // seguinte da ordem, e não o bootstrap local
    const ordem = ordenarAlternativas([localLento, pago, assinatura], "assinatura_paga_local").map((x) => x.key);
    expect(ordem.indexOf("claude/claude-opus-5")).toBeLessThan(ordem.indexOf("gateway/gpt-6-sol"));
    expect(ordem.indexOf("gateway/gpt-6-sol")).toBeLessThan(ordem.indexOf("local/qwen2.5:7b"));
  });

  it("só o local disponível ainda atende", () => {
    // sem nuvem nenhuma, a casa não pode ficar sem resposta
    expect(ordenarAlternativas([localLento], "assinatura_paga_local")[0]!.key).toBe("local/qwen2.5:7b");
  });

  it("lista vazia não quebra", () => {
    expect(ordenarAlternativas([], "assinatura_paga_local")).toEqual([]);
  });
});
