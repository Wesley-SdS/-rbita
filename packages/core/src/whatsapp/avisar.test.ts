import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Aviso pela conversa "Eu". O que fica travado: respeita "nenhum", o silêncio
 * (menos lembrete, que fura), o teto por hora; e o que foi mandado entra no
 * histórico, para o "paga" ter contexto.
 */
let cfg: Record<string, unknown>;
let sessao: { status: string; jid: string | null } | null;
const enviarTexto = vi.fn(async (..._a: unknown[]) => ({}));
const registrarNoHistorico = vi.fn(async (..._a: unknown[]) => undefined);
vi.mock("../settings", () => ({ settings: { getMany: async () => cfg } }));
vi.mock("./sessao", () => ({ sessaoDe: async () => sessao }));
vi.mock("./enviar", () => ({ enviarTexto }));
vi.mock("./conversa", () => ({ registrarNoHistorico }));
vi.mock("@orbita/db", () => ({ db: {} }));

const { avisarNoWhatsapp, _zerarTeto } = await import("./avisar");

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-27T15:00:00Z")); // 12:00 em São Paulo
  _zerarTeto();
  cfg = { "whatsapp.avisos": "todos", "whatsapp.avisosSilencio": "", "whatsapp.avisosPorHora": 2, "connectors.fusoHorario": "America/Sao_Paulo" };
  sessao = { status: "conectado", jid: "5511900000000:4@s.whatsapp.net" };
});

afterEach(() => {
  vi.useRealTimers();
});

describe("avisarNoWhatsapp", () => {
  it("rajada SIMULTÂNEA respeita o teto (a vaga é reservada antes do envio)", async () => {
    // os envios ficam pendurados, como numa ponte lenta: é quando a rajada passava
    enviarTexto.mockImplementation(() => new Promise(() => undefined));
    const resultados: string[] = [];
    for (const [t, c] of [["a", "1"], ["b", "2"], ["c", "3"], ["d", "4"]]) void avisarNoWhatsapp("u1", t, c).then((r) => resultados.push(r));
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(resultados).toEqual(["teto", "teto"]);
    expect(enviarTexto).toHaveBeenCalledTimes(2);
    enviarTexto.mockReset();
    enviarTexto.mockImplementation(async () => ({}));
  });

  it("envio que falha devolve a vaga", async () => {
    enviarTexto.mockRejectedValueOnce(new Error("ponte fora"));
    expect(await avisarNoWhatsapp("u1", "t", "c")).toBe("falhou");
    await avisarNoWhatsapp("u1", "a", "1");
    expect(await avisarNoWhatsapp("u1", "b", "2")).toBe("enviado");
  });

  it("manda na conversa 'Eu' com o título em negrito e guarda no histórico", async () => {
    expect(await avisarNoWhatsapp("u1", "Contas a vencer (1)", "Internet R$ 99,90 amanhã")).toBe("enviado");
    // título, linha em branco e corpo: colados viravam um bloco só no celular
    expect(enviarTexto).toHaveBeenCalledWith("u1", "5511900000000@s.whatsapp.net", "*Contas a vencer (1)*\n\nInternet R$ 99,90 amanhã", { aprovacaoHumana: true });
    expect(registrarNoHistorico).toHaveBeenCalledWith("u1", "aviso", "*Contas a vencer (1)*\n\nInternet R$ 99,90 amanhã");
  });

  it("desligado, sem WhatsApp conectado", async () => {
    cfg["whatsapp.avisos"] = "nenhum";
    expect(await avisarNoWhatsapp("u1", "t", "c")).toBe("desligado");
    cfg["whatsapp.avisos"] = "todos";
    sessao = { status: "desconectado", jid: null };
    expect(await avisarNoWhatsapp("u1", "t", "c")).toBe("sem_whatsapp");
    expect(enviarTexto).not.toHaveBeenCalled();
  });

  it("no silêncio fica só no app; lembrete marcado pelo dono fura", async () => {
    cfg["whatsapp.avisosSilencio"] = "11:00-13:00";
    expect(await avisarNoWhatsapp("u1", "t", "c")).toBe("silencio");
    expect(await avisarNoWhatsapp("u1", "Lembrete", "ligar pro contador", { furaSilencio: true })).toBe("enviado");
  });

  it("teto por hora: a rajada fica no app; o briefing não conta nem obedece o 'nenhum'", async () => {
    await avisarNoWhatsapp("u1", "a", "1");
    await avisarNoWhatsapp("u1", "b", "2");
    expect(await avisarNoWhatsapp("u1", "c", "3")).toBe("teto");
    cfg["whatsapp.avisos"] = "nenhum";
    expect(await avisarNoWhatsapp("u1", "Bom dia", "resumo", { tipo: "briefing" })).toBe("enviado");
  });

  it("envio que falhou não lança (aviso é fail-soft)", async () => {
    enviarTexto.mockRejectedValueOnce(new Error("ponte fora"));
    expect(await avisarNoWhatsapp("u1", "t", "c")).toBe("falhou");
  });
});
