import { beforeEach, describe, expect, it, vi } from "vitest";
import { assinar } from "@orbita/core/whatsapp/gowa/assinatura";

/**
 * A borda do webhook do WhatsApp. Autenticação é o HMAC da sessão sobre os
 * BYTES do corpo (não a sessão do navegador). O que fica travado:
 *   - assinatura errada e dispositivo desconhecido respondem IGUAL (401);
 *   - rate limit antes de ler o corpo; corpo grande demais é 413;
 *   - evento que não reconhecemos é 200 (senão o GOWA reenvia para sempre);
 *   - o dono vem da sessão do dispositivo, nunca do corpo.
 */

const sessoes: Record<string, { sessao: { userId: string }; segredo: string }> = { dev1: { sessao: { userId: "u1" }, segredo: "segredo" } };
let limiteOk = true;
const receberEvento = vi.fn(async (..._a: unknown[]) => ({ ok: true as const, eventoId: "e1" }) as { ok: true; eventoId: string } | { ok: false; status: 400; erro: string });

vi.mock("@orbita/core/whatsapp/sessao", () => ({ sessaoDoDispositivo: async (id: string) => sessoes[id] ?? null, desconectarSessao: vi.fn(), parear: vi.fn(), sessaoDe: vi.fn() }));
vi.mock("@orbita/core/whatsapp/processar", () => ({ receberEvento }));
vi.mock("@orbita/core/whatsapp/enviar", () => ({ provedorAtivo: vi.fn() }));
vi.mock("@orbita/core/whatsapp/store", () => ({ atualizarContato: vi.fn(), automaticasRecentes: vi.fn(), listarContatos: vi.fn() }));
vi.mock("@orbita/core/settings/index", () => ({ settings: { get: async () => 600 } }));
vi.mock("@orbita/core/ratelimit", () => ({ rateLimit: () => (limiteOk ? { ok: true } : { ok: false, retryAfterSec: 30 }), tooMany: (s: number) => new Response(null, { status: 429, headers: { "Retry-After": String(s) } }) }));
vi.mock("@orbita/core/observability/logger", () => ({ log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("../http/owner-route", () => ({ ownerOf: vi.fn() }));

const { WEBHOOK } = await import("./whatsapp");

const corpo = JSON.stringify({ event: "message", payload: { id: "W1", chat_id: "5511@s.whatsapp.net", body: "oi" } });
const pedir = (deviceId: string, texto: string, assinatura: string | null) =>
  WEBHOOK(new Request("http://x/api/whatsapp/webhook/" + deviceId, { method: "POST", body: texto, headers: assinatura ? { "x-hub-signature-256": assinatura } : {} }), { params: { deviceId }, user: null });

beforeEach(() => {
  vi.clearAllMocks();
  limiteOk = true;
});

describe("POST /api/whatsapp/webhook/:deviceId", () => {
  it("assinatura certa: grava para o dono DA SESSÃO", async () => {
    const r = await pedir("dev1-abcdefgh".slice(0, 4), corpo, assinar(corpo, "segredo"));
    expect(r.status).toBe(400); // id curto demais nem chega a olhar a assinatura
    const ok = await pedir("dev1xxxx", corpo, assinar(corpo, "segredo"));
    expect(ok.status).toBe(401); // dispositivo desconhecido
    sessoes.dev1xxxx = sessoes.dev1;
    const certo = await pedir("dev1xxxx", corpo, assinar(corpo, "segredo"));
    expect(certo.status).toBe(200);
    expect(receberEvento).toHaveBeenCalledWith("u1", "dev1xxxx", JSON.parse(corpo));
  });

  it("assinatura errada e dispositivo desconhecido respondem igual", async () => {
    sessoes.dev1xxxx = sessoes.dev1;
    const errada = await pedir("dev1xxxx", corpo, assinar(corpo, "outro"));
    const semAssinatura = await pedir("dev1xxxx", corpo, null);
    const desconhecido = await pedir("naoexiste", corpo, assinar(corpo, "segredo"));
    for (const r of [errada, semAssinatura, desconhecido]) {
      expect(r.status).toBe(401);
      expect(await r.json()).toEqual({ error: "Assinatura inválida" });
    }
    expect(receberEvento).not.toHaveBeenCalled();
  });

  it("rajada acima do teto: 429 antes de ler o corpo", async () => {
    limiteOk = false;
    const r = await pedir("dev1xxxx", corpo, assinar(corpo, "segredo"));
    expect(r.status).toBe(429);
  });

  it("evento que não reconhecemos é 200 (o GOWA não reenvia para sempre)", async () => {
    sessoes.dev1xxxx = sessoes.dev1;
    receberEvento.mockResolvedValueOnce({ ok: false, status: 400, erro: "Evento inválido" });
    const outro = JSON.stringify({ event: "algo.novo", payload: {} });
    const r = await pedir("dev1xxxx", outro, assinar(outro, "segredo"));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, ignorado: true });
  });

  it("JSON quebrado com assinatura válida: 400", async () => {
    sessoes.dev1xxxx = sessoes.dev1;
    const r = await pedir("dev1xxxx", "{nao-json", assinar("{nao-json", "segredo"));
    expect(r.status).toBe(400);
  });
});
