import { describe, it, expect } from "vitest";
import { nomesAfirmaveis, nomesNaConversa } from "./nomes-na-conversa";

/**
 * QUEM É CADA VOZ, PELO QUE FOI DITO.
 *
 * O caso que motivou isto: o Lucas disse "eu me chamo Lucas" em voz alta e a
 * reunião o chamou de "Desconhecido 1", porque ele não tinha assinatura de voz
 * cadastrada. O nome estava ali, escrito na transcrição.
 *
 * O que estes testes protegem dos dois lados: reconhecer o nome quando ele foi
 * dito, e NÃO inventar pessoa a partir de palavra capitalizada — um nome errado
 * se espalha para o resumo, para as tarefas e para a memória da casa.
 */

const f = (speaker: string, text: string, i = 0) => ({ speaker, text, startMs: i * 1000, endMs: i * 1000 + 900 });

describe("quem se apresentou", () => {
  it("“eu me chamo Lucas” dá nome à voz de quem falou", () => {
    const r = nomesNaConversa([f("A", "Órbita, me chamo Wesley, estou apresentando a plataforma."), f("B", "Eu me chamo Lucas e vou apresentar o Órion.", 1)]);
    expect(r).toEqual([
      { label: "A", nome: "Wesley", fonte: "apresentacao", trecho: "Órbita, me chamo Wesley, estou apresentando a plataforma." },
      { label: "B", nome: "Lucas", fonte: "apresentacao", trecho: "Eu me chamo Lucas e vou apresentar o Órion." },
    ]);
  });

  it("aceita as outras formas de se apresentar", () => {
    const formas = [
      "Meu nome é William e eu cuido do financeiro.",
      "Eu sou a Marcela, prazer.",
      "Eu sou Rafael.",
      "Aqui é o Bruno.",
      "Aqui quem fala é a Camila.",
    ];
    const nomes = formas.map((t) => nomesNaConversa([f("A", t)])[0]?.nome);
    expect(nomes).toEqual(["William", "Marcela", "Rafael", "Bruno", "Camila"]);
  });
});

describe("quem foi chamado pelo nome", () => {
  it("“William, te mandei o doc” nomeia quem responde, não quem falou", () => {
    // é o caso NORMAL de reunião: ninguém se apresenta, as pessoas se chamam
    const r = nomesNaConversa([
      f("A", "William, te mandei o doc que você pediu."),
      f("B", "Recebi sim, obrigado. Vou olhar hoje ainda.", 1),
    ]);
    expect(r).toEqual([{ label: "B", nome: "William", fonte: "chamado", trecho: "William, te mandei o doc que você pediu." }]);
  });

  it("nome no fim da pergunta também vale", () => {
    const r = nomesNaConversa([f("A", "Me fala das suas tarefas, Marcela?"), f("B", "Tenho três abertas.", 1)]);
    expect(r).toEqual([{ label: "B", nome: "Marcela", fonte: "chamado", trecho: "Me fala das suas tarefas, Marcela?" }]);
  });

  it("interjeição antes do nome não atrapalha (“Ô Lucas, ...”)", () => {
    // frase real de 26/09/2026: o "Ô" sozinho derrubava o reconhecimento
    const r = nomesNaConversa([f("A", "Ô Lucas, você viu a página de testes ontem?"), f("B", "Eu vi sim.", 1)]);
    expect(r).toEqual([{ label: "B", nome: "Lucas", fonte: "chamado", trecho: "Ô Lucas, você viu a página de testes ontem?" }]);
  });

  it("as outras interjeições do português falado também passam", () => {
    const falas = ["Ei Marcela, me manda aquilo?", "Olha William, preciso do doc.", "Oi Rafael, tudo certo?"];
    const nomes = falas.map((t) => nomesNaConversa([f("A", t), f("B", "Claro.", 1)])[0]?.nome);
    expect(nomes).toEqual(["Marcela", "William", "Rafael"]);
  });

  it("chamado sem ninguém respondendo não vira nada", () => {
    // supor que o ausente é o dono da última voz seria inventar
    expect(nomesNaConversa([f("A", "Marcela, me manda aquilo depois.")])).toEqual([]);
  });
});

describe("não inventa gente", () => {
  it("palavra capitalizada de início de frase não é pessoa", () => {
    // a transcrição capitaliza toda frase: sem a lista de apoio, apareceria
    // alguém chamado "Então"
    const r = nomesNaConversa([
      f("A", "Então, vamos começar."),
      f("B", "Bom, por mim tudo certo.", 1),
      f("A", "Pessoal, obrigado pela presença.", 2),
      f("B", "Beleza, valeu.", 3),
    ]);
    expect(r).toEqual([]);
  });

  it("a Órbita não é participante", () => {
    expect(nomesNaConversa([f("A", "Órbita, resume essa reunião."), f("B", "Pode deixar.", 1)])).toEqual([]);
  });

  it("duas vozes dizendo ser a mesma pessoa: nenhuma passa", () => {
    // aconteceu num teste real, com a fala de um vazando para a etiqueta do
    // outro — melhor ficar sem nome do que dar o nome à voz errada
    const r = nomesNaConversa([f("A", "Eu me chamo Lucas."), f("B", "Eu me chamo Lucas também.", 1)]);
    expect(r).toEqual([]);
  });

  it("quem se apresentou vence quem foi só chamado com o mesmo nome", () => {
    const r = nomesNaConversa([
      f("A", "Eu me chamo Lucas."),
      f("B", "Lucas, você viu aquilo?", 1),
      f("C", "Vi sim.", 2),
    ]);
    expect(r).toEqual([{ label: "A", nome: "Lucas", fonte: "apresentacao", trecho: "Eu me chamo Lucas." }]);
  });

  it("uma voz com dois nomes de mesma força fica sem nome", () => {
    const r = nomesNaConversa([f("A", "Eu me chamo Lucas."), f("A", "Meu nome é Rafael.", 1)]);
    expect(r).toEqual([]);
  });

  it("lista vazia e fala vazia não quebram", () => {
    expect(nomesNaConversa([])).toEqual([]);
    expect(nomesNaConversa([f("A", "")])).toEqual([]);
  });
});

describe("o que pode ser AFIRMADO", () => {
  it("só a apresentação vira nome na transcrição", () => {
    // "William, te mandei o doc" é palpite bom, e palpite não entra numa
    // transcrição que vira resumo, tarefa e memória da casa
    const sugeridos = [
      { label: "A", nome: "Lucas", fonte: "apresentacao" as const, trecho: "eu me chamo Lucas" },
      { label: "B", nome: "William", fonte: "chamado" as const, trecho: "William, te mandei" },
    ];
    expect(nomesAfirmaveis(sugeridos)).toEqual({ A: "Lucas" });
  });
});
