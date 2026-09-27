import { describe, expect, it } from "vitest";
import { dataDoGowa, ehGrupo, normalizarJid, numeroDoJid, traduzirMensagem } from "./traduzir";
import { gowaEventExternalId, gowaEventSchema } from "./gowa/eventos";
import { assinar, assinaturaValida } from "./gowa/assinatura";

/** Exemplos no formato do `docs/webhook-payload.md` do GOWA (os mesmos do workspace). */
const texto = {
  id: "3EB0A1",
  chat_id: "5511999998888@s.whatsapp.net",
  from: "5511999998888:12@s.whatsapp.net",
  from_name: "Maria",
  timestamp: "2026-09-27T10:00:00Z",
  is_from_me: false,
  body: "Chega que horas?",
};

describe("tradução do payload do GOWA", () => {
  it("texto de pessoa", () => {
    const t = traduzirMensagem(texto);
    expect(t).toMatchObject({ externalId: "3EB0A1", chatJid: "5511999998888@s.whatsapp.net", autorJid: "5511999998888@s.whatsapp.net", autorNome: "Maria", tipo: "texto", texto: "Chega que horas?", deMim: false, grupo: false, status: false, midia: null });
    expect(t.em.toISOString()).toBe("2026-09-27T10:00:00.000Z");
  });

  it("áudio chega como caminho local; imagem com legenda vira texto", () => {
    expect(traduzirMensagem({ ...texto, body: undefined, audio: "statics/media/abc.ogg" })).toMatchObject({ tipo: "audio", texto: null, midia: { kind: "audio", path: "statics/media/abc.ogg" } });
    const img = traduzirMensagem({ ...texto, body: undefined, image: { path: "statics/media/x.jpg", caption: " o cupom ", mime_type: "image/jpeg" } });
    expect(img).toMatchObject({ tipo: "imagem", texto: "o cupom", midia: { kind: "image", path: "statics/media/x.jpg", mimeType: "image/jpeg" } });
  });

  it("grupo, status e mensagem minha", () => {
    expect(traduzirMensagem({ ...texto, chat_id: "120363@g.us" }).grupo).toBe(true);
    expect(traduzirMensagem({ ...texto, chat_id: "status@broadcast" }).status).toBe(true);
    expect(traduzirMensagem({ ...texto, is_from_me: true }).deMim).toBe(true);
  });

  it("localização e contato sem mídia", () => {
    expect(traduzirMensagem({ ...texto, body: undefined, location: { lat: 1 } }).tipo).toBe("localizacao");
    expect(traduzirMensagem({ ...texto, body: undefined, contact: { name: "x" } }).tipo).toBe("contato");
  });

  it("data em RFC3339, epoch em segundos e em milissegundos", () => {
    expect(dataDoGowa(1790000000).getTime()).toBe(1790000000000);
    expect(dataDoGowa(1790000000123).getTime()).toBe(1790000000123);
    expect(dataDoGowa("1790000000").getTime()).toBe(1790000000000);
    const reserva = new Date(0);
    expect(dataDoGowa("lixo", reserva)).toBe(reserva);
  });
});

describe("JID", () => {
  it("tira o sufixo do aparelho: é o que faz a conversa 'Eu' casar com o número do dono", () => {
    expect(normalizarJid("5511999998888:12@s.whatsapp.net")).toBe("5511999998888@s.whatsapp.net");
    expect(normalizarJid("+55 (11) 99999-8888")).toBe("5511999998888@s.whatsapp.net");
    expect(normalizarJid("120363@G.US")).toBe("120363@g.us");
  });

  it("número só de JID de pessoa", () => {
    expect(numeroDoJid("5511999998888@s.whatsapp.net")).toBe("5511999998888");
    expect(numeroDoJid("120363@g.us")).toBeNull();
    expect(ehGrupo("120363@g.us")).toBe(true);
  });
});

describe("eventos do webhook", () => {
  it("mensagem, apagada, editada e reação têm chave de idempotência; presença não", () => {
    const env = (event: string, payload: Record<string, unknown>) => gowaEventSchema.parse({ event, device_id: "x", payload });
    expect(gowaEventExternalId(env("message", texto))).toBe("3EB0A1");
    expect(gowaEventExternalId(env("message.revoked", { revoked_message_id: "R1" }))).toBe("R1");
    expect(gowaEventExternalId(env("message.edited", { id: "E1", original_message_id: "O1" }))).toBe("E1");
    // quem reagiu entra na chave: duas pessoas reagindo não são reentrega
    const reacao = (emoji: string, timestamp?: string) => gowaEventExternalId(env("message.reaction", { reacted_message_id: "M1", from: "a", emoji, timestamp }));
    expect(reacao("👍")).toBe("M1:a:👍:");
    // trocar ou remover a reação é evento NOVO, não reentrega
    expect(reacao("❤️")).not.toBe(reacao("👍"));
    expect(reacao("")).not.toBe(reacao("👍"));
    expect(reacao("👍", "2026-09-27T10:00:00Z")).not.toBe(reacao("👍", "2026-09-27T10:05:00Z"));
    expect(gowaEventExternalId(env("chat_presence", { chat_id: "x", state: "composing" }))).toBeNull();
  });

  it("mensagem torta (sem id) não vira a chave \"undefined\"", () => {
    const torta = gowaEventSchema.parse({ event: "message", payload: { body: "sem chat_id nem id" } });
    expect(gowaEventExternalId(torta)).toBeNull();
  });

  it("evento desconhecido cai no envelope genérico e não derruba", () => {
    expect(gowaEventSchema.safeParse({ event: "newsletter.joined", payload: { qualquer: 1 } }).success).toBe(true);
  });
});

describe("assinatura do webhook", () => {
  const corpo = new TextEncoder().encode(JSON.stringify({ event: "message", payload: texto }));

  it("aceita a assinatura certa, com ou sem o prefixo sha256=", () => {
    const a = assinar(corpo, "segredo");
    expect(assinaturaValida(corpo, a, "segredo")).toBe(true);
    expect(assinaturaValida(corpo, a.slice("sha256=".length), "segredo")).toBe(true);
  });

  it("falha fechada: ausente, malformada, outro segredo, corpo mexido", () => {
    expect(assinaturaValida(corpo, null, "segredo")).toBe(false);
    expect(assinaturaValida(corpo, "sha256=zz", "segredo")).toBe(false);
    expect(assinaturaValida(corpo, assinar(corpo, "outro"), "segredo")).toBe(false);
    // reserializar o JSON muda os bytes: por isso a rota guarda o corpo cru
    const reserializado = new TextEncoder().encode(JSON.stringify(JSON.parse(new TextDecoder().decode(corpo)), null, 1));
    expect(assinaturaValida(reserializado, assinar(corpo, "segredo"), "segredo")).toBe(false);
    expect(assinaturaValida(corpo, assinar(corpo, "segredo"), "")).toBe(false);
  });
});
