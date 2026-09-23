import { describe, expect, it } from "vitest";
import { splitFala, prontoParaFalar } from "./engine";

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

/**
 * A fala que acompanha o texto chegando.
 *
 * O TTS já cortava em pedaços; o que esperava era o CHAT: a voz só era chamada
 * no `onFinish`, com a resposta inteira. O silêncio era o tempo de escrever
 * tudo somado ao de sintetizar o começo.
 *
 * O que só se vê testando: falar antes de a frase fechar corta a fala no meio
 * ("Vou" vira "Vou mandar amanhã" dois tokens depois), e não falar nunca é o
 * outro extremo, quando a resposta inteira não tem ponto final.
 */
describe("prontoParaFalar", () => {
  it("não fala enquanto a frase não fecha", () => {
    // "Vou" ainda pode virar "Vou mandar amanhã"
    const r = prontoParaFalar("Vou mandar o relatório", false);
    expect(r.prontos).toEqual([]);
    expect(r.resto).toBe("Vou mandar o relatório");
  });

  it("solta até o último fim de frase e guarda o resto", () => {
    const r = prontoParaFalar("Consegui achar o contrato que você pediu ontem. Agora vou", false);
    expect(r.prontos.length).toBeGreaterThan(0);
    expect(r.prontos.join(" ")).toContain("contrato");
    expect(r.resto.trim()).toBe("Agora vou");
  });

  it("frase fechada curta demais ESPERA (não vale a ida e volta)", () => {
    const r = prontoParaFalar("Oi. ", false);
    expect(r.prontos).toEqual([]);
  });

  it("no FIM, o que sobrou sai de qualquer tamanho", () => {
    // senão "Sim." nunca seria falado
    const r = prontoParaFalar("Sim.", false, true);
    expect(r.prontos).toEqual(["Sim."]);
    expect(r.resto).toBe("");
  });

  it("no fim, texto sem pontuação nenhuma também sai", () => {
    const r = prontoParaFalar("pronto", true, true);
    expect(r.prontos).toEqual(["pronto"]);
  });

  it("quebra de linha conta como fim de frase", () => {
    const texto = "Achei três coisas sobre o contrato de manutenção\nvou detalhar";
    const r = prontoParaFalar(texto, false);
    expect(r.prontos.length).toBeGreaterThan(0);
    expect(r.resto.trim()).toBe("vou detalhar");
  });

  it("depois do primeiro trecho o alvo sobe: não pica a fala em migalhas", () => {
    // o 1º trecho manda na latência e pode ser curto; os seguintes, não
    // 54 caracteres: passa do alvo do 1º trecho (45) e não do dos seguintes (80)
    const curto = "Certo, entendi o seu pedido e já estou cuidando disso. ";
    expect(prontoParaFalar(curto, false).prontos.length).toBeGreaterThan(0);
    expect(prontoParaFalar(curto, true).prontos).toEqual([]);
  });

  it("nada a falar não vira trecho vazio", () => {
    expect(prontoParaFalar("", false, true).prontos).toEqual([]);
    expect(prontoParaFalar("   ", false, true).prontos).toEqual([]);
  });

  it("alimentado token a token, nunca repete nem perde texto", () => {
    // é a garantia que importa: o que foi falado mais o que sobrou tem de ser
    // exatamente o que o modelo escreveu
    const resposta = "Achei o contrato que você pediu. Ele vence em outubro. Quer que eu marque um lembrete?";
    let buffer = "";
    let jaFalou = false;
    const falado: string[] = [];
    for (const ch of resposta) {
      buffer += ch;
      const r = prontoParaFalar(buffer, jaFalou);
      if (r.prontos.length) {
        falado.push(...r.prontos);
        buffer = r.resto;
        jaFalou = true;
      }
    }
    const fim = prontoParaFalar(buffer, jaFalou, true);
    falado.push(...fim.prontos);

    const juntado = falado.join(" ").replace(/\s+/g, " ").trim();
    expect(juntado).toBe(resposta);
  });
});
