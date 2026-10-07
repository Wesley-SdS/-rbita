import { describe, expect, it } from "vitest";
import { decidirAutomatico, decidirEnvio, escolherProposta, interpretarResposta, normalizarFrase, trocasRoboticas } from "./regras";

const CONFIRMAR = ["manda", "pode mandar", "envia", "sim", "confirmo", "pode"];
const CANCELAR = ["cancela", "não", "deixa", "não manda"];

describe("antibanimento", () => {
  const limites = { porMinuto: 20, porDia: 300 };
  const base = { contatoEscreveu: true, aprovacaoHumana: false, enviadasUltimoMinuto: 0, enviadasUltimas24h: 0 };

  it("responder quem já escreveu passa", () => {
    expect(decidirEnvio(base, limites)).toEqual({ ok: true });
  });

  it("puxar conversa com quem nunca escreveu só com aprovação humana", () => {
    expect(decidirEnvio({ ...base, contatoEscreveu: false }, limites)).toMatchObject({ ok: false, motivo: "abordagem_fria" });
    expect(decidirEnvio({ ...base, contatoEscreveu: false, aprovacaoHumana: true }, limites)).toEqual({ ok: true });
  });

  it("o teto por minuto e por dia valem até com aprovação", () => {
    expect(decidirEnvio({ ...base, aprovacaoHumana: true, enviadasUltimoMinuto: 20 }, limites)).toMatchObject({ ok: false, motivo: "por_minuto" });
    expect(decidirEnvio({ ...base, aprovacaoHumana: true, enviadasUltimas24h: 300 }, limites)).toMatchObject({ ok: false, motivo: "por_dia" });
  });
});

describe("aprovar falando", () => {
  it("normaliza acento, caixa e pontuação", () => {
    expect(normalizarFrase("  Não, MANDA!! ")).toBe("nao manda");
  });

  it("a frase sozinha ou com enchimento aprova", () => {
    expect(interpretarResposta("manda", CONFIRMAR, CANCELAR)).toEqual({ acao: "confirmar" });
    expect(interpretarResposta("Pode mandar sim!", CONFIRMAR, CANCELAR)).toEqual({ acao: "confirmar" });
    expect(interpretarResposta("manda aí", CONFIRMAR, CANCELAR)).toEqual({ acao: "confirmar" });
  });

  it("o número escolhe da lista", () => {
    expect(interpretarResposta("manda a 2", CONFIRMAR, CANCELAR)).toEqual({ acao: "confirmar", escolha: 2 });
    expect(interpretarResposta("cancela 1", CONFIRMAR, CANCELAR)).toEqual({ acao: "cancelar", escolha: 1 });
  });

  it("vários da lista numa mensagem só (o caso real: \"Manda 1 manda 2\")", () => {
    expect(interpretarResposta("Manda 1 manda 2", CONFIRMAR, CANCELAR)).toEqual({ acao: "confirmar", escolhas: [1, 2] });
    expect(interpretarResposta("manda 1 e 3", CONFIRMAR, CANCELAR)).toEqual({ acao: "confirmar", escolhas: [1, 3] });
    expect(interpretarResposta("manda 1, 2", CONFIRMAR, CANCELAR)).toEqual({ acao: "confirmar", escolhas: [1, 2] });
    expect(interpretarResposta("cancela 2 e 3", CONFIRMAR, CANCELAR)).toEqual({ acao: "cancelar", escolhas: [2, 3] });
  });

  it("\"manda tudo\" e \"as duas\" pegam a lista inteira", () => {
    expect(interpretarResposta("manda tudo", CONFIRMAR, CANCELAR)).toEqual({ acao: "confirmar", todas: true });
    expect(interpretarResposta("manda as duas", CONFIRMAR, CANCELAR)).toEqual({ acao: "confirmar", todas: true });
    expect(interpretarResposta("cancela tudo", CONFIRMAR, CANCELAR)).toEqual({ acao: "cancelar", todas: true });
    // pedido novo continua sendo pedido, mesmo com número no meio
    expect(interpretarResposta("manda 2 mil pra Maria", CONFIRMAR, CANCELAR)).toEqual({ acao: null });
  });

  it("\"não manda\" é cancelar, não confirmar", () => {
    expect(interpretarResposta("não manda", CONFIRMAR, CANCELAR)).toEqual({ acao: "cancelar" });
    expect(interpretarResposta("Não", CONFIRMAR, CANCELAR)).toEqual({ acao: "cancelar" });
  });

  it("frase com conteúdo novo NÃO é resposta: vira pedido", () => {
    // errar para "aprovou" manda uma mensagem que não se desfaz
    expect(interpretarResposta("não, manda amanhã às 8", CONFIRMAR, CANCELAR)).toEqual({ acao: null });
    expect(interpretarResposta("manda um oi pra Maria", CONFIRMAR, CANCELAR)).toEqual({ acao: null });
    expect(interpretarResposta("sim, e qual meu saldo?", CONFIRMAR, CANCELAR)).toEqual({ acao: null });
    expect(interpretarResposta("", CONFIRMAR, CANCELAR)).toEqual({ acao: null });
  });

  const agora = new Date("2026-09-27T12:00:00Z");
  const p = (id: string, minAtras: number, expiraEmMin: number | null) => ({
    id,
    resumo: `proposta ${id}`,
    criadaEm: new Date(agora.getTime() - minAtras * 60_000),
    expiraEm: expiraEmMin === null ? null : new Date(agora.getTime() + expiraEmMin * 60_000),
  });

  it("escolhidas: os números da lista, tudo, e número fora da lista mostra a lista", () => {
    const lista = [p("a", 3, 29), p("b", 2, 29), p("c", 1, 29)];
    expect(escolherProposta(lista, agora, undefined, [1, 3])).toEqual({ tipo: "escolhidas", ids: ["a", "c"] });
    expect(escolherProposta(lista, agora, undefined, undefined, true)).toEqual({ tipo: "escolhidas", ids: ["a", "b", "c"] });
    expect(escolherProposta(lista, agora, undefined, [1, 9]).tipo).toBe("fora_da_lista");
  });

  it("uma válida: é ela", () => {
    expect(escolherProposta([p("a", 1, 29)], agora)).toEqual({ tipo: "uma", id: "a" });
  });

  it("vencida não conta: um 'manda' horas depois não dispara nada", () => {
    expect(escolherProposta([p("a", 120, -90)], agora)).toEqual({ tipo: "nenhuma" });
  });

  it("várias sem número devolvem a LISTA, nunca um palpite", () => {
    const r = escolherProposta([p("b", 1, 29), p("a", 5, 25)], agora);
    expect(r.tipo).toBe("varias");
    // em ordem de criação: "manda 1" é a mais antiga
    if (r.tipo === "varias") expect(r.lista.map((x) => x.id)).toEqual(["a", "b"]);
    expect(escolherProposta([p("b", 1, 29), p("a", 5, 25)], agora, 1)).toEqual({ tipo: "uma", id: "a" });
    expect(escolherProposta([p("a", 1, 29)], agora, 3).tipo).toBe("fora_da_lista");
  });
});

describe("resposta automática", () => {
  const agora = new Date("2026-09-27T12:00:00Z");
  const base = { modo: "automatico" as const, grupo: false, pausadoAte: null, agora, respostasUltimaHora: 0, trocasRoboticas: 0 };
  const limites = { porHora: 10, seguidas: 4 };

  it("contato marcado responde", () => {
    expect(decidirAutomatico(base, limites)).toEqual({ responder: true });
  });

  it("contato não marcado, grupo e pausado não respondem", () => {
    expect(decidirAutomatico({ ...base, modo: "aprovar" }, limites)).toMatchObject({ responder: false, motivo: "desligado" });
    // grupo nunca, mesmo marcado por engano
    expect(decidirAutomatico({ ...base, grupo: true }, limites)).toMatchObject({ responder: false, motivo: "grupo" });
    expect(decidirAutomatico({ ...base, pausadoAte: new Date(agora.getTime() + 60_000) }, limites)).toMatchObject({ responder: false, motivo: "pausado" });
  });

  it("teto por hora e robô do outro lado pausam", () => {
    expect(decidirAutomatico({ ...base, respostasUltimaHora: 10 }, limites)).toEqual({ responder: false, motivo: "por_hora", pausar: true });
    expect(decidirAutomatico({ ...base, trocasRoboticas: 4 }, limites)).toEqual({ responder: false, motivo: "laco", pausar: true });
  });

  const m = (s: number, deMim: boolean, automatica = false, enviadaPelaOrbita = automatica) => ({ em: new Date(agora.getTime() + s * 1000), deMim, automatica, enviadaPelaOrbita });

  it("conta trocas em que o contato responde em segundos, repetidas vezes", () => {
    const conversa = [m(0, false), m(3, true, true), m(5, false), m(8, true, true), m(10, false)];
    expect(trocasRoboticas(conversa, 8000)).toBe(2);
  });

  it("gente leva tempo para digitar: troca lenta não é robô", () => {
    const conversa = [m(0, false), m(3, true, true), m(60, false), m(64, true, true), m(66, false)];
    expect(trocasRoboticas(conversa, 8000)).toBe(1);
  });

  it("o dono escrevendo à mão zera a conta", () => {
    const conversa = [m(0, true, true), m(2, false), m(3, true), m(4, true, true), m(6, false)];
    expect(trocasRoboticas(conversa, 8000)).toBe(1);
  });
});
