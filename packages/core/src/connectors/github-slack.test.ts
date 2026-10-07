import { afterEach, describe, expect, it, vi } from "vitest";
import { novidadesDaPr, type PrDoGithub } from "./github";
import { oQueChegouNoSlack } from "./slack";

/**
 * O que chega para o dono no GitHub e no Slack. Travado: o que ele mesmo
 * escreveu e o que é de robô ficam de fora, o envelope vazio do review não
 * vira novidade, comentário de linha e de conversa com o mesmo número não se
 * confundem, e a mesma mensagem do Slack não entra duas vezes.
 */

afterEach(() => vi.unstubAllGlobals());

const pr: PrDoGithub = { id: 1, repo: "org/app", numero: 42, titulo: "Corrige o login", url: "https://github.com/org/app/pull/42", autor: "wesley", atualizadaEm: "2026-10-06T12:00:00Z", rascunho: false };
const desde = new Date("2026-10-06T10:00:00Z");

describe("novidades de uma PR", () => {
  it("reviews e comentários dos outros, depois do marcador", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const corpo = String(url).includes("/reviews")
        ? [
            { id: 1, state: "CHANGES_REQUESTED", body: "Falta teste", submitted_at: "2026-10-06T11:00:00Z", html_url: "r1", user: { login: "ana" } },
            { id: 2, state: "COMMENTED", body: "", submitted_at: "2026-10-06T11:05:00Z", html_url: "r2", user: { login: "ana" } },
            { id: 3, state: "APPROVED", body: "", submitted_at: "2026-10-06T09:00:00Z", html_url: "r3", user: { login: "caio" } },
          ]
        : String(url).includes("/pulls/42/comments")
          ? [{ id: 7, body: "Renomeia isto", created_at: "2026-10-06T11:06:00Z", html_url: "c7", user: { login: "ana" } }]
          : [
              { id: 7, body: "Mesma numeração, outra tabela", created_at: "2026-10-06T11:10:00Z", html_url: "i7", user: { login: "caio" } },
              { id: 8, body: "eu mesmo", created_at: "2026-10-06T11:11:00Z", html_url: "i8", user: { login: "Wesley" } },
              { id: 9, body: "Coverage 80%", created_at: "2026-10-06T11:12:00Z", html_url: "i9", user: { login: "codecov[bot]", type: "Bot" } },
            ];
      return new Response(JSON.stringify(corpo));
    }));
    const n = await novidadesDaPr("t", pr, desde, "wesley");
    expect(n.map((x) => x.eventoId)).toEqual(["review:1", "linha:7", "conversa:7"]);
    expect(n[0]).toMatchObject({ tipo: "review", estado: "CHANGES_REQUESTED", autor: "ana", texto: "Falta teste" });
  });
});

describe("o que chegou no Slack", () => {
  it("menção e mensagem direta, sem as minhas, sem repetir e com a menção legível", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const u = decodeURIComponent(String(url));
      if (u.includes("auth.test")) return new Response(JSON.stringify({ ok: true, user_id: "UEU" }));
      const mencoes = [
        { ts: "1791300000.000100", user: "U1", username: "rafa", text: "<@UEU> olha o deploy?", permalink: "p1", channel: { id: "C1", name: "time-dev" } },
        { ts: "1791300001.000100", user: "UEU", text: "<@UEU> nota para mim", channel: { id: "C1", name: "time-dev" } },
        { ts: "1791300002.000100", user: "U2", username: "lu", text: "<@UEU> e aí", channel: { id: "D9", is_im: true } },
      ];
      const diretas = [{ ts: "1791300002.000100", user: "U2", username: "lu", text: "<@UEU> e aí", channel: { id: "D9", is_im: true } }];
      return new Response(JSON.stringify({ ok: true, messages: { matches: u.includes("to:me") ? diretas : mencoes } }));
    }));
    const r = await oQueChegouNoSlack("xoxp", "c1", new Date(1791299000 * 1000));
    expect(r.map((m) => [m.tipo, m.canal, m.autor, m.texto])).toEqual([
      ["mensagem_direta", "mensagem direta", "lu", "@você e aí"],
      ["mencao", "#time-dev", "rafa", "@você olha o deploy?"],
    ]);
  });
});
