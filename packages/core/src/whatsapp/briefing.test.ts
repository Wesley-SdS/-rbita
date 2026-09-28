import { beforeEach, describe, expect, it, vi } from "vitest";

/** O briefing: um por dia, montado só com leitura, com o dia gravado ANTES de mandar. */
let sessao: Record<string, unknown> | null;
const ordem: string[] = [];
const runPromptForUser = vi.fn(async (..._a: unknown[]) => {
  ordem.push("montar");
  return "Hoje: reunião às 10h. Contas: internet amanhã. Pode gastar R$ 120.";
});
const avisarNoWhatsapp = vi.fn(async (..._a: unknown[]) => "enviado");
const notifyUser = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock("../routines/run", () => ({ runPromptForUser, notifyUser }));
vi.mock("./avisar", () => ({ avisarNoWhatsapp }));
vi.mock("./sessao", () => ({ sessaoDe: async () => sessao }));
let bot: Record<string, unknown> | null = null;
let donoTg: Record<string, unknown> | null = null;
const marcarBriefing = vi.fn(async (_u: string, dia: string) => void (bot!.ultimoBriefing = dia));
vi.mock("../telegram/store", () => ({ botDe: async () => bot, donoNoTelegram: async () => donoTg, marcarBriefing }));
const avisarNoTelegram = vi.fn(async (..._a: unknown[]) => "enviado");
vi.mock("../telegram/enviar", () => ({ avisarNoTelegram }));
vi.mock("../settings", () => ({
  settings: {
    getMany: async () => ({ "whatsapp.briefingAtivo": true, "whatsapp.briefingHorario": "07:00", "whatsapp.briefingDias": "todos", "whatsapp.briefingPedido": "Monte o briefing", "telegram.briefing": true, "connectors.fusoHorario": "America/Sao_Paulo" }),
  },
}));
vi.mock("@orbita/db", () => ({
  db: {
    update: () => ({
      set: (v: Record<string, unknown>) => ({
        where: async () => {
          ordem.push("gravar");
          Object.assign(sessao!, v);
        },
      }),
    }),
  },
}));

const { briefingSeDevido } = await import("./briefing");
const as7h05 = new Date("2026-09-28T10:05:00Z"); // segunda, 07:05 em São Paulo

beforeEach(() => {
  vi.clearAllMocks();
  ordem.length = 0;
  sessao = { id: "s1", status: "conectado", ultimoBriefing: null };
  bot = null;
  donoTg = null;
});

describe("briefingSeDevido", () => {
  it("na hora: grava o dia ANTES, monta com leitura e todas as tools, e manda", async () => {
    expect(await briefingSeDevido("u1", as7h05)).toBe("enviado");
    expect(ordem).toEqual(["gravar", "montar"]);
    expect(runPromptForUser).toHaveBeenCalledWith("u1", "Monte o briefing", expect.any(String), expect.objectContaining({ soLeitura: true, todas: true }));
    expect(avisarNoWhatsapp).toHaveBeenCalledWith("u1", "Bom dia", expect.stringContaining("reunião às 10h"), { tipo: "briefing" });
  });

  it("já mandou hoje: nada (nem depois de reiniciar)", async () => {
    await briefingSeDevido("u1", as7h05);
    expect(await briefingSeDevido("u1", new Date("2026-09-28T10:20:00Z"))).toBe("fora_de_hora");
    expect(runPromptForUser).toHaveBeenCalledOnce();
  });

  it("antes da hora, ou sem WhatsApp conectado", async () => {
    expect(await briefingSeDevido("u1", new Date("2026-09-28T09:00:00Z"))).toBe("fora_de_hora");
    sessao = { id: "s1", status: "desconectado", ultimoBriefing: null };
    expect(await briefingSeDevido("u1", as7h05)).toBe("sem_canal");
  });

  it("Telegram também: montado UMA vez e entregue nos dois canais, cada um com o seu dia", async () => {
    bot = { ultimoBriefing: null };
    donoTg = { id: "c1", telegramId: "99" };
    expect(await briefingSeDevido("u1", as7h05)).toBe("enviado");
    expect(runPromptForUser).toHaveBeenCalledOnce();
    expect(avisarNoWhatsapp).toHaveBeenCalledOnce();
    expect(avisarNoTelegram).toHaveBeenCalledWith("u1", "Bom dia", expect.stringContaining("reunião às 10h"), { tipo: "briefing" });
    expect(bot.ultimoBriefing).toBe("2026-09-28");
  });

  it("só com Telegram (WhatsApp desconectado): sai por lá", async () => {
    sessao = { id: "s1", status: "desconectado", ultimoBriefing: null };
    bot = { ultimoBriefing: null };
    donoTg = { id: "c1", telegramId: "99" };
    expect(await briefingSeDevido("u1", as7h05)).toBe("enviado");
    expect(avisarNoWhatsapp).not.toHaveBeenCalled();
    expect(avisarNoTelegram).toHaveBeenCalledOnce();
  });

  it("modelo fora do ar: não quebra o laço, e o dono fica sabendo no app", async () => {
    runPromptForUser.mockRejectedValueOnce(new Error("sem modelo"));
    expect(await briefingSeDevido("u1", as7h05)).toBe("falhou");
    expect(notifyUser).toHaveBeenCalledWith("u1", "Briefing de hoje", expect.stringContaining("Não consegui"), null, expect.objectContaining({ whatsapp: false }));
  });

  it("montou mas o WhatsApp não levou: o briefing fica no app, não se perde", async () => {
    avisarNoWhatsapp.mockResolvedValueOnce("falhou");
    expect(await briefingSeDevido("u1", as7h05)).toBe("falhou");
    expect(notifyUser).toHaveBeenCalledWith("u1", "Bom dia", expect.stringContaining("reunião às 10h"), null, expect.objectContaining({ whatsapp: false }));
  });
});
