import { describe, it, expect } from "vitest";
import { RuleInputSchema } from "./engine";

/**
 * O destino do aviso é para onde o sino leva quando a pessoa clica.
 *
 * Ele é gravado por uma REGRA, e regra é dado que o dono edita pela tela. Se
 * aceitasse endereço com host, bastaria uma regra mal escrita (ou colada de
 * algum lugar) para o aviso da Órbita virar um caminho para fora do app. Por
 * isso o schema só aceita caminho interno, e é isto que estes testes prendem.
 */
const regra = (destino: unknown) =>
  RuleInputSchema.safeParse({
    name: "Contas",
    trigger: { kind: "event", type: "finance.bill_due" },
    actions: [{ kind: "notify", title: "Contas", body: "resumo", destino }],
  });

describe("destino do aviso", () => {
  it("aceita caminho interno, com e sem query", () => {
    expect(regra("/app/financas").success).toBe(true);
    expect(regra("/app/conversa?pergunta=oi").success).toBe(true);
    expect(regra("/app").success).toBe(true);
  });

  it("aceita ausente e nulo: nem todo aviso leva a algum lugar", () => {
    expect(regra(undefined).success).toBe(true);
    expect(regra(null).success).toBe(true);
  });

  it("recusa endereço com host, que tiraria o dono do app", () => {
    expect(regra("https://exemplo.com/phish").success).toBe(false);
    expect(regra("//exemplo.com").success).toBe(false);
    expect(regra("http://localhost:3000/app").success).toBe(false);
  });

  it("recusa esquema executável e caminho relativo", () => {
    expect(regra("javascript:alert(1)").success).toBe(false);
    expect(regra("data:text/html,<script>").success).toBe(false);
    expect(regra("app/financas").success).toBe(false);
  });
});
