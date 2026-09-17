import { describe, it, expect, vi, beforeAll } from "vitest";
import type { casa_acionar_com_aprovacao as CasaAcionarComAprovacao } from "./casa";

/**
 * Testes da correção de auditoria (pós-Onda 6): o gate de `casa_acionar`
 * media risco pelo domínio de `entidade`, mas o Home Assistant executa o
 * par (servico, dados) — que podia redirecionar o alvo real. Os dois
 * refusals abaixo acontecem ANTES de qualquer chamada ao HA/banco, então
 * cobrem as duas tools sem precisar de conexão real.
 *
 * `import("./casa")` puxa `@orbita/db` (client Postgres) na cadeia de
 * módulos; sob carga cheia da suíte isso passou de 5s uma vez. Carregado
 * uma única vez em `beforeAll` para não pagar esse custo por teste.
 */
const ctx = { userId: "u1" };
let casa_acionar_com_aprovacao: typeof CasaAcionarComAprovacao;

beforeAll(async () => {
  ({ casa_acionar_com_aprovacao } = await import("./casa"));
}, 20000);

describe("casa: defesa contra redirecionamento de alvo (auditoria)", () => {
  it("recusa domínio de despacho (scene) mesmo na tool com aprovação, mesmo tentando destrancar via dados.entities", async () => {
    const r = (await casa_acionar_com_aprovacao.run(
      { entidade: "scene.qualquer", servico: "apply", dados: { entities: { "lock.porta_frente": "unlocked" } } },
      ctx,
    )) as { acionado: boolean; erro?: string };
    expect(r.acionado).toBe(false);
    expect(r.erro).toMatch(/não é acionável/);
  });

  it("recusa homeassistant.* (serviço genérico que aceita entity_id de qualquer domínio)", async () => {
    const r = (await casa_acionar_com_aprovacao.run(
      { entidade: "homeassistant.x", servico: "turn_on", dados: { entity_id: "cover.garagem" } },
      ctx,
    )) as { acionado: boolean; erro?: string };
    expect(r.acionado).toBe(false);
    expect(r.erro).toMatch(/não é acionável/);
  });

  it("recusa dados.entity_id tentando redirecionar o alvo de um domínio inofensivo", async () => {
    const r = (await casa_acionar_com_aprovacao.run(
      { entidade: "light.sala", servico: "turn_on", dados: { entity_id: "lock.porta_frente" } },
      ctx,
    )) as { acionado: boolean; erro?: string };
    expect(r.acionado).toBe(false);
    expect(r.erro).toMatch(/dados/);
  });

  it("dados sem chave de redirecionamento passa da checagem (só falha depois, sem HA conectado)", async () => {
    // requireConnection() lança fora do try/catch de runAcionar (comportamento
    // pré-existente, fora do escopo desta correção): aqui só confirmamos que a
    // checagem de dados NÃO barrou esta chamada antes de chegar lá.
    await expect(casa_acionar_com_aprovacao.run({ entidade: "climate.quarto", servico: "set_temperature", dados: { temperature: 22 } }, ctx)).rejects.toThrow(
      /Home Assistant não conectado/,
    );
  });
});

describe("casa_acionar: recusa por risco de domínio antes de tentar executar", () => {
  it("domínio gated (lock) nunca chega a montar a chamada ao HA", async () => {
    vi.resetModules();
    vi.doMock("../../home/access", () => ({ loadDomainRiskOverrides: vi.fn().mockResolvedValue(new Map()) }));
    const { casa_acionar } = await import("./casa");
    const r = (await casa_acionar.run({ entidade: "lock.porta_frente", servico: "unlock" }, ctx)) as { acionado: boolean; erro?: string };
    expect(r.acionado).toBe(false);
    expect(r.erro).toMatch(/aprovação/);
    vi.doUnmock("../../home/access");
    vi.resetModules();
  });
});
