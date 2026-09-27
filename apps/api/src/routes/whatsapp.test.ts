import { beforeEach, describe, expect, it, vi } from "vitest";
import { assinar } from "@orbita/core/whatsapp/gowa/assinatura";

/**
 * A borda do WhatsApp. O webhook autentica pelo HMAC da sessão sobre os BYTES
 * do corpo (não pela sessão do navegador); o resto é tela do dono.
 */

let sessoes: Record<string, { sessao: { userId: string }; segredo: string }>;
let limiteOk = true;
let dono: { userId: string } | Response;
const contatos = [
  { id: "11111111-1111-4111-8111-111111111111", grupo: false, jid: "a@s.whatsapp.net", nome: "Maria", apelido: null, modo: "aprovar" },
  { id: "22222222-2222-4222-8222-222222222222", grupo: true, jid: "g@g.us", nome: "Família", apelido: null, modo: "aprovar" },
];
const receberEvento = vi.fn(async (..._a: unknown[]) => ({ ok: true as const, eventoId: "e1" }) as { ok: true; eventoId: string } | { ok: false; status: 400; erro: string });
const atualizarContato = vi.fn(async (..._a: unknown[]) => ({}));

vi.mock("@orbita/core/whatsapp/sessao", () => ({ sessaoDoDispositivo: async (id: string) => sessoes[id] ?? null, desconectarSessao: vi.fn(), parear: vi.fn(), sessaoDe: vi.fn() }));
vi.mock("@orbita/core/whatsapp/processar", () => ({ receberEvento }));
vi.mock("@orbita/core/whatsapp/enviar", () => ({ provedorAtivo: vi.fn() }));
vi.mock("@orbita/core/whatsapp/store", () => ({ atualizarContato, automaticasRecentes: vi.fn(), listarContatos: async () => contatos }));
vi.mock("@orbita/core/settings/index", () => ({ settings: { get: async () => 600 } }));
vi.mock("@orbita/core/ratelimit", () => ({ rateLimit: () => (limiteOk ? { ok: true } : { ok: false, retryAfterSec: 30 }), tooMany: (s: number) => new Response(null, { status: 429, headers: { "Retry-After": String(s) } }) }));
vi.mock("@orbita/core/observability/logger", () => ({ log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));
vi.mock("../http/owner-route", () => ({ ownerOf: async () => dono }));

const { WEBHOOK, PATCH_CONTATO } = await import("./whatsapp");

const DEV = "dispositivo-1";
const corpo = JSON.stringify({ event: "message", payload: { id: "W1", chat_id: "5511@s.whatsapp.net", body: "oi" } });
const pedir = (deviceId: string, texto: string | Uint8Array, assinatura: string | null) =>
  WEBHOOK(
    new Request("http://x/api/whatsapp/webhook/" + deviceId, { method: "POST", body: typeof texto === "string" ? texto : new Blob([new Uint8Array(texto)]), headers: assinatura ? { "x-hub-signature-256": assinatura } : {} }),
    { params: { deviceId }, user: null },
  );

beforeEach(() => {
  vi.clearAllMocks();
  limiteOk = true;
  sessoes = { [DEV]: { sessao: { userId: "u1" }, segredo: "segredo" } };
  dono = { userId: "u1" };
});

describe("POST /api/whatsapp/webhook/:deviceId", () => {
  it("assinatura certa: grava para o dono DA SESSÃO (nunca do corpo)", async () => {
    const r = await pedir(DEV, corpo, assinar(corpo, "segredo"));
    expect(r.status).toBe(200);
    expect(receberEvento).toHaveBeenCalledWith("u1", DEV, JSON.parse(corpo));
  });

  it("id de dispositivo malformado: 400 sem olhar assinatura", async () => {
    expect((await pedir("abc", corpo, assinar(corpo, "segredo"))).status).toBe(400);
  });

  it("assinatura errada, ausente e dispositivo desconhecido respondem IGUAL (quem sonda não descobre ids)", async () => {
    for (const r of [await pedir(DEV, corpo, assinar(corpo, "outro")), await pedir(DEV, corpo, null), await pedir("nao-existe-1", corpo, assinar(corpo, "segredo"))]) {
      expect(r.status).toBe(401);
      expect(await r.json()).toEqual({ error: "Assinatura inválida" });
    }
    expect(receberEvento).not.toHaveBeenCalled();
  });

  it("rajada acima do teto: 429", async () => {
    limiteOk = false;
    expect((await pedir(DEV, corpo, assinar(corpo, "segredo"))).status).toBe(429);
  });

  it("corpo grande demais: 413", async () => {
    const grande = new Uint8Array(10 * 1024 * 1024 + 1);
    expect((await pedir(DEV, grande, assinar(grande, "segredo"))).status).toBe(413);
  });

  it("evento que não reconhecemos é 200 (o GOWA não reenvia para sempre)", async () => {
    receberEvento.mockResolvedValueOnce({ ok: false, status: 400, erro: "Evento inválido" });
    const outro = JSON.stringify({ event: "algo.novo", payload: {} });
    const r = await pedir(DEV, outro, assinar(outro, "segredo"));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, ignorado: true });
  });

  it("JSON quebrado com assinatura válida: 400", async () => {
    expect((await pedir(DEV, "{nao-json", assinar("{nao-json", "segredo"))).status).toBe(400);
  });
});

describe("PATCH /api/whatsapp/contatos/:id", () => {
  const patch = (id: string, body: unknown) => PATCH_CONTATO(new Request("http://x", { method: "PATCH", body: JSON.stringify(body) }), { params: { id }, user: { id: "u1", email: "", name: "" } });

  it("só o dono: quem não é recebe o 403 do guard", async () => {
    dono = Response.json({ error: "Somente o dono" }, { status: 403 });
    expect((await patch(contatos[0].id, { modo: "automatico" })).status).toBe(403);
    expect(atualizarContato).not.toHaveBeenCalled();
  });

  it("grupo nunca tem resposta automática", async () => {
    const r = await patch(contatos[1].id, { modo: "automatico" });
    expect(r.status).toBe(400);
    expect(atualizarContato).not.toHaveBeenCalled();
  });

  it("contato que não existe: 404; id inválido: 400", async () => {
    expect((await patch("33333333-3333-4333-8333-333333333333", { modo: "automatico" })).status).toBe(404);
    expect((await patch("nao-uuid", { modo: "automatico" })).status).toBe(400);
  });

  it("ligar o automático e dar apelido", async () => {
    expect((await patch(contatos[0].id, { modo: "automatico", apelido: "mãe" })).status).toBe(200);
    expect(atualizarContato).toHaveBeenCalledWith("u1", contatos[0].id, { apelido: "mãe", modo: "automatico" });
  });
});
