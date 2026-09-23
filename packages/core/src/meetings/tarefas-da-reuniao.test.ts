import { describe, it, expect } from "vitest";
import { ehMeu, tarefasDeCompromissos } from "./tarefas-da-reuniao";

/**
 * O que ficou para você fazer depois da reunião.
 *
 * Os compromissos já eram extraídos e paravam dentro do texto do resumo: quem
 * lesse via, quem não lesse esquecia. O que este arquivo trava é a decisão de
 * QUAIS viram tarefa, porque errar para mais enche a lista com o que os outros
 * combinaram, e errar para menos perde justamente o que isto veio resolver.
 */

const c = (descricao: string, responsavel?: string, prazo?: string) => ({ descricao, responsavel, prazo });

describe("o compromisso é meu?", () => {
  it("sem responsável conta como meu", () => {
    // quem gravou a reunião é o dono, e "vou mandar o relatório" dito por ele
    // raramente vem com o nome junto
    expect(ehMeu(undefined, "Wesley")).toBe(true);
    expect(ehMeu("", "Wesley")).toBe(true);
    expect(ehMeu("   ", "Wesley")).toBe(true);
  });

  it("meu nome conta, com ou sem acento e caixa", () => {
    expect(ehMeu("Wesley", "wesley")).toBe(true);
    expect(ehMeu("WESLEY SANTOS", "Wesley")).toBe(true);
    expect(ehMeu("Antônio", "antonio")).toBe(true);
  });

  it("nome de outra pessoa não é meu", () => {
    expect(ehMeu("Madalena", "Wesley")).toBe(false);
    expect(ehMeu("o cliente", "Wesley")).toBe(false);
  });

  it('"Locutor A" NÃO é meu', () => {
    // é rótulo de diarização, não nome: tratar como o dono encheria a lista
    // com o que os outros combinaram
    for (const r of ["Locutor A", "locutor B", "Speaker 2", "Participante 3"]) {
      expect(ehMeu(r, "Wesley"), r).toBe(false);
    }
  });

  it("sem saber meu nome, só o que ninguém assumiu é meu", () => {
    expect(ehMeu(undefined, "")).toBe(true);
    expect(ehMeu("Madalena", "")).toBe(false);
  });
});

describe("os compromissos virando tarefa", () => {
  const base = { meuNome: "Wesley", reuniaoId: "doc-1", reuniaoTitulo: "Semanal de compras" };
  const compromissos = [c("revisar o contrato"), c("mandar a proposta", "Madalena"), c("assinar a carta", "Wesley", "2026-10-05")];

  it('"minhas" traz só as minhas', () => {
    const t = tarefasDeCompromissos(compromissos, { ...base, quem: "minhas" });
    expect(t.map((x) => x.texto)).toEqual(["revisar o contrato", "assinar a carta"]);
  });

  it('"todas" traz tudo que foi combinado', () => {
    const t = tarefasDeCompromissos(compromissos, { ...base, quem: "todas" });
    expect(t).toHaveLength(3);
  });

  it('"nenhuma" não cria nada', () => {
    expect(tarefasDeCompromissos(compromissos, { ...base, quem: "nenhuma" })).toEqual([]);
  });

  it("a tarefa guarda de onde veio e para quem", () => {
    // é o que responde "por que eu fiquei de fazer isso?" duas semanas depois
    const [t] = tarefasDeCompromissos([c("mandar a proposta", "Madalena")], { ...base, quem: "todas" });
    expect(t).toMatchObject({
      texto: "mandar a proposta",
      paraQuem: "Madalena",
      origem: { tipo: "reuniao", id: "doc-1", titulo: "Semanal de compras", trecho: "mandar a proposta" },
    });
  });

  it("prazo explícito vira data; texto solto não vira", () => {
    // tarefa com data errada é pior do que tarefa sem data
    const comData = tarefasDeCompromissos([c("assinar", "Wesley", "2026-10-05")], { ...base, quem: "todas" });
    expect(comData[0]!.vencimento).toContain("2026-10-05");

    const semData = tarefasDeCompromissos([c("assinar", "Wesley", "quando der")], { ...base, quem: "todas" });
    expect(semData[0]!.vencimento).toBeNull();
  });

  it("compromisso vazio não vira tarefa em branco", () => {
    expect(tarefasDeCompromissos([c("   "), c("")], { ...base, quem: "todas" })).toEqual([]);
  });

  it("reunião sem documento ainda gera tarefa, só sem o id do vínculo", () => {
    // o arquivamento pode ter falhado; perder a tarefa junto seria pior
    const [t] = tarefasDeCompromissos([c("revisar")], { ...base, quem: "minhas", reuniaoId: null });
    expect(t!.origem).toMatchObject({ tipo: "reuniao", id: null, titulo: "Semanal de compras" });
  });

  it("lista vazia não quebra", () => {
    expect(tarefasDeCompromissos([], { ...base, quem: "minhas" })).toEqual([]);
  });
});
