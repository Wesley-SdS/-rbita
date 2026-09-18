import { describe, expect, it } from "vitest";
import { avancar, devoOlhar, lerVeredito, montarPergunta, normalizarPassos } from "./rules";

/**
 * Acompanhar tarefa (PRD §5.4). O que está sendo provado aqui é a regra que
 * evita o pior erro possível: avançar um passo que a pessoa NÃO fez. Modelo de
 * visão pequeno responde em prosa e erra; na dúvida, a Órbita fica quieta.
 */

describe("quando olhar de novo", () => {
  const agora = new Date("2026-09-17T12:00:00Z");
  it("primeira olhada acontece na hora", () => {
    expect(devoOlhar(null, 45, agora)).toBe(true);
  });
  it("respeita o intervalo configurado", () => {
    expect(devoOlhar(new Date(agora.getTime() - 20_000), 45, agora)).toBe(false);
    expect(devoOlhar(new Date(agora.getTime() - 45_000), 45, agora)).toBe(true);
  });
});

describe("leitura da resposta da câmera", () => {
  it("sim explícito avança", () => {
    expect(lerVeredito("SIM, a massa já está no forno.")).toBe("terminou");
    expect(lerVeredito("Sim")).toBe("terminou");
  });

  it("não explícito espera", () => {
    expect(lerVeredito("NÃO, a pessoa ainda está batendo a massa.")).toBe("ainda_nao");
    expect(lerVeredito("não terminou")).toBe("ainda_nao");
    expect(lerVeredito("Ainda não, falta misturar.")).toBe("ainda_nao");
  });

  it("dúvida NUNCA vira avanço", () => {
    for (const r of ["NÃO DÁ PARA SABER", "não consigo ver a bancada", "A imagem está muito escura", "não sei dizer", ""]) {
      expect(lerVeredito(r), r).toBe("nao_da_para_saber");
    }
  });

  it("prosa sem sim nem não fica em dúvida, não avança", () => {
    expect(lerVeredito("Uma pessoa na cozinha, com uma tigela na mão.")).toBe("nao_da_para_saber");
  });

  it("acento e caixa não mudam a decisão", () => {
    expect(lerVeredito("sim, ja terminou")).toBe("terminou");
    expect(lerVeredito("Nao, ainda esta mexendo")).toBe("ainda_nao");
  });
});

describe("avanço de passo", () => {
  const passos = ["bater a massa", "untar a forma", "levar ao forno"];
  it("vai para o próximo e devolve o texto", () => {
    expect(avancar(passos, 0)).toEqual({ proximo: 1, concluiu: false, texto: "untar a forma" });
  });
  it("no último passo, conclui", () => {
    expect(avancar(passos, 2)).toEqual({ proximo: 3, concluiu: true, texto: null });
  });
});

describe("pergunta e passos", () => {
  it("monta a pergunta com o passo e o nome da tarefa", () => {
    const q = montarPergunta("A pessoa terminou {passo}? Tarefa: {tarefa}.", "untar a forma", "bolo");
    expect(q).toBe("A pessoa terminou untar a forma? Tarefa: bolo.");
  });

  it("limpa passo vazio, corta passo gigante e respeita o teto da config", () => {
    const passos = normalizarPassos(["  bater   a massa ", "", "   ", "x".repeat(400), "untar", "assar"], 3);
    expect(passos).toHaveLength(3);
    expect(passos[0]).toBe("bater a massa");
    expect(passos[1]!.endsWith("…")).toBe(true);
    expect(passos[1]!.length).toBe(300);
  });
});
