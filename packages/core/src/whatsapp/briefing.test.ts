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
let modelos: unknown[] = [{ key: "claude/claude-sonnet-5" }];
vi.mock("@orbita/llm", () => ({ discoverModels: async () => modelos }));
vi.mock("../settings/apply", () => ({ applyLlmSettings: async () => undefined }));
let bot: Record<string, unknown> | null = null;
let donoTg: Record<string, unknown> | null = null;
const marcarBriefing = vi.fn(async (_u: string, dia: string) => void (bot!.ultimoBriefing = dia));
vi.mock("../telegram/store", () => ({ botDe: async () => bot, donoNoTelegram: async () => donoTg, marcarBriefing }));
const avisarNoTelegram = vi.fn(async (..._a: unknown[]) => "enviado");
vi.mock("../telegram/enviar", () => ({ avisarNoTelegram }));
let emAudio = false;
vi.mock("../settings", () => ({
  settings: {
    getMany: async () => ({ "whatsapp.briefingAtivo": true, "whatsapp.briefingHorario": "07:00", "whatsapp.briefingDias": "todos", "whatsapp.briefingPedido": "Monte o briefing", "whatsapp.briefingAudio": emAudio, "casa.trabalhoPorDia": ["ter, qui: Companhia de Estágios", "seg, qua, sex: Adalink"], "telegram.briefing": true, "connectors.fusoHorario": "America/Sao_Paulo" }),
  },
}));
let audioFalha = false;
const enviarAudio = vi.fn(async (..._a: unknown[]) => {
  if (audioFalha) throw new Error("conversão indisponível");
  return { provedor: "pessoal", id: "m1", para: "5511@s.whatsapp.net" };
});
vi.mock("./enviar", () => ({ enviarAudio }));
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
  sessao = { id: "s1", status: "conectado", ultimoBriefing: null, jid: "5511999999999@s.whatsapp.net" };
  bot = null;
  emAudio = false;
  audioFalha = false;
  donoTg = null;
});

describe("bom dia em áudio, com o trânsito do trabalho do dia (pedido de 06/10/2026)", () => {
  it("em áudio: vai como nota de voz, e o pedido diz que dia é e para qual trabalho pedir a rota", async () => {
    emAudio = true;
    expect(await briefingSeDevido("u1", as7h05)).toBe("enviado");
    expect(enviarAudio).toHaveBeenCalledWith("u1", "5511999999999@s.whatsapp.net", expect.stringContaining("reunião às 10h"), { aprovacaoHumana: true });
    expect(avisarNoWhatsapp).not.toHaveBeenCalled();
    const instrucao = String(runPromptForUser.mock.calls[0]![2]);
    expect(instrucao).toContain("Hoje é segunda-feira, 28/09.");
    expect(instrucao).toContain('rota de casa até "Adalink"');
    expect(instrucao).toContain("NOTA DE VOZ");
  });

  it("o áudio falhou: o bom dia vai em texto, não se perde", async () => {
    emAudio = true;
    audioFalha = true;
    expect(await briefingSeDevido("u1", as7h05)).toBe("enviado");
    expect(avisarNoWhatsapp).toHaveBeenCalledWith("u1", "Bom dia", expect.stringContaining("reunião às 10h"), { tipo: "briefing" });
  });

  it("terça é dia da Companhia de Estágios", async () => {
    await briefingSeDevido("u1", new Date("2026-09-29T10:05:00Z"));
    expect(String(runPromptForUser.mock.calls[0]![2])).toContain('rota de casa até "Companhia de Estágios"');
  });
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

  it("api acabou de subir e ainda não há modelo: NÃO marca o dia, tenta no minuto seguinte", async () => {
    modelos = [];
    try {
      expect(await briefingSeDevido("u1", as7h05)).toBe("sem_modelo");
      expect(sessao!.ultimoBriefing).toBeNull();
      expect(runPromptForUser).not.toHaveBeenCalled();
    } finally {
      modelos = [{ key: "claude/claude-sonnet-5" }];
    }
    expect(await briefingSeDevido("u1", as7h05)).toBe("enviado");
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
