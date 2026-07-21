import { describe, expect, it } from "vitest";
import { splitFala } from "./engine";

/** Junta os trechos ignorando espaços — nada do texto original pode sumir. */
const compacta = (s: string) => s.replace(/\s/g, "");

describe("splitFala", () => {
  const casos: [string, string][] = [
    ["frase curta", "Claro, já anotei."],
    ["duas frases", "Bom dia, Wesley! Já separei sua agenda e o resumo do dia. Quer que eu comece por onde?"],
    [
      "resposta longa",
      "Bom dia! Você tem três compromissos hoje, sendo o primeiro às nove da manhã com a equipe de produto. Também separei dois e-mails que parecem urgentes e uma cobrança que vence amanhã. Quer que eu detalhe algum?",
    ],
    ["sem pontuação", "ok"],
    ["reticências", "Hmm... deixa eu ver. Achei!"],
    ["lista com quebras", "Tarefas de hoje:\nComprar pão\nLigar pro médico\nPagar a conta"],
    [
      "frase gigante sem ponto final",
      "vamos revisar o contrato e depois falar com o financeiro, checar as pendências do mês passado, confirmar os pagamentos recorrentes, revisar as assinaturas ativas, cancelar o que não usamos mais e por fim montar o relatório consolidado do trimestre",
    ],
  ];

  it.each(casos)("não perde texto: %s", (_nome, texto) => {
    expect(compacta(splitFala(texto).join(""))).toBe(compacta(texto));
  });

  it.each(casos)("não gera trecho vazio nem acima do teto: %s", (_nome, texto) => {
    const trechos = splitFala(texto);
    expect(trechos.length).toBeGreaterThan(0);
    for (const t of trechos) {
      expect(t.trim()).not.toBe("");
      expect(t.length).toBeLessThanOrEqual(200);
    }
  });

  it("mantém frase curta num único pedido (evita RTT à toa)", () => {
    expect(splitFala("Claro, já anotei.")).toHaveLength(1);
  });

  it("quebra a resposta longa para a fala começar antes", () => {
    const longa = casos[2][1];
    const trechos = splitFala(longa);
    expect(trechos.length).toBeGreaterThan(1);
    // o ganho de latência vem do primeiro trecho ser bem menor que o todo
    expect(trechos[0].length).toBeLessThan(longa.length / 2);
  });

  it("faz o 1º trecho curto e deixa os seguintes maiores", () => {
    // síntese ≈ duração do áudio: começar rápido importa mais no 1º trecho.
    const trechos = splitFala(casos[2][1]);
    expect(trechos[0].length).toBeLessThanOrEqual(80);
    expect(Math.max(...trechos.slice(1).map((t) => t.length))).toBeGreaterThan(trechos[0].length);
  });

  it("parte na vírgula quando não há ponto final", () => {
    const trechos = splitFala(casos[6][1]);
    expect(trechos.length).toBeGreaterThan(1);
  });

  it("texto vazio ou só espaços não gera trecho", () => {
    expect(splitFala("")).toEqual([]);
    expect(splitFala("   \n  ")).toEqual([]);
  });
});
