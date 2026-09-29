import { describe, expect, it, vi } from "vitest";

/**
 * A ação "avisar" de uma regra passava o id da REGRA no campo `routineId` do
 * aviso, que é chave estrangeira para ROTINA: o banco recusava e o aviso nunca
 * saía (27/09/2026, "Reunião em breve" do calendar watch). Trava o contrato:
 * aviso de regra não aponta para rotina nenhuma.
 */

const notifyUser = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock("../routines/run", () => ({ notifyUser: (...a: unknown[]) => notifyUser(...a), runPromptForUser: vi.fn() }));
vi.mock("../events/index", () => ({ events: { emit: vi.fn(async () => undefined) } }));
vi.mock("@orbita/db", () => ({ db: { update: () => ({ set: () => ({ where: async () => undefined }) }) } }));

const { fireRuleNow } = await import("./run");

describe("ação avisar", () => {
  it("vai sem routineId, com o texto do evento", async () => {
    const regra = {
      id: "933602d1-8785-42a1-bf6c-8aea8076cb83",
      userId: "u1",
      name: "Aviso de reunião",
      enabled: true,
      trigger: { kind: "event", type: "calendar.meeting_upcoming" },
      conditions: [],
      actions: [{ kind: "notify", title: "Reunião em breve: {{payload.titulo}}", body: "{{payload.resumo}}" }],
    };
    expect(await fireRuleNow(regra as never, { payload: { titulo: "Planejar a semana", resumo: "Às 21:00." } })).toBe(true);
    expect(notifyUser).toHaveBeenCalledWith("u1", "Reunião em breve: Planejar a semana", "Às 21:00.", null, { personId: null, destino: null, origem: "regra" });
  });

  it("regra de fábrica avisa como sistema (sino), regra do dono como regra (Rotinas)", async () => {
    const { origemDoAviso } = await import("./run");
    expect(origemDoAviso({ builtinKey: "calendar.meeting_upcoming" })).toBe("sistema");
    expect(origemDoAviso({ builtinKey: null })).toBe("regra");
  });
});
