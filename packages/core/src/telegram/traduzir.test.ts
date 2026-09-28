import { describe, expect, it } from "vitest";
import { botoesDaProposta, codigoDoStart, lerBotao, traduzirMensagem } from "./traduzir";

/** O que chega do Telegram, no formato da Órbita (parte pura). */

const base = { message_id: 7, date: 1_790_000_000, chat: { id: 99, type: "private" }, from: { id: 99, first_name: "Anna", last_name: "Santos", username: "anna" } };

describe("traduzirMensagem", () => {
  it("texto, com quem mandou e a hora", () => {
    expect(traduzirMensagem({ ...base, text: "acende a luz" })).toMatchObject({ chatId: "99", telegramId: "99", messageId: "7", nome: "Anna Santos", tipo: "texto", texto: "acende a luz", grupo: false, em: new Date(1_790_000_000_000) });
  });
  it("nota de voz, foto (a maior), documento-imagem, localização", () => {
    expect(traduzirMensagem({ ...base, voice: { file_id: "v1", mime_type: "audio/ogg" } })).toMatchObject({ tipo: "audio", fileId: "v1", mime: "audio/ogg" });
    expect(traduzirMensagem({ ...base, photo: [{ file_id: "p1", width: 90, height: 90 }, { file_id: "p2", width: 800, height: 800 }], caption: "o cupom" })).toMatchObject({ tipo: "imagem", fileId: "p2", texto: "o cupom" });
    expect(traduzirMensagem({ ...base, document: { file_id: "d1", mime_type: "image/png" } })).toMatchObject({ tipo: "imagem", fileId: "d1" });
    expect(traduzirMensagem({ ...base, location: { latitude: -23.5, longitude: -46.6 } })).toMatchObject({ tipo: "localizacao", texto: "-23.5,-46.6" });
  });
  it("grupo é marcado (o bot não conversa em grupo); mensagem de outro bot é ignorada", () => {
    expect(traduzirMensagem({ ...base, chat: { id: -5, type: "group" }, text: "oi" })?.grupo).toBe(true);
    expect(traduzirMensagem({ ...base, from: { id: 1, is_bot: true }, text: "oi" })).toBeNull();
  });
});

describe("convite e botão", () => {
  it("/start com código vira o código; qualquer outra coisa, nulo", () => {
    expect(codigoDoStart("/start abcDEF123_-xyz")).toBe("abcDEF123_-xyz");
    expect(codigoDoStart("/start@orbita_bot abcDEF123")).toBe("abcDEF123");
    expect(codigoDoStart("/start")).toBeNull();
    expect(codigoDoStart("/start curto")).toBeNull();
    expect(codigoDoStart("oi")).toBeNull();
  });
  it("botão: só o formato exato vale (dado de botão é entrada não confiável)", () => {
    const id = "5f0c2c7e-6d8f-4d38-9a36-1c1d5b9d2a11";
    expect(lerBotao(`ap:${id}`)).toEqual({ acao: "aprovar", propostaId: id });
    expect(lerBotao(`rc:${id}`)).toEqual({ acao: "recusar", propostaId: id });
    expect(lerBotao(`ap:${id}; drop table`)).toBeNull();
    expect(lerBotao("ap:1")).toBeNull();
    expect(botoesDaProposta(id)[0].map((b) => b.callback_data)).toEqual([`ap:${id}`, `rc:${id}`]);
  });
});
