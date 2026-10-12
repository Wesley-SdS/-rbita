import type { BlocoClaude, MensagemClaude, RespostaClaudeDireto } from "@orbita/llm";

/**
 * O CONTEXTO DA TAREFA NO WINDOWS (PRD-MOTOR-DESKTOP §7.4). Cada screenshot custa
 * de 1.000 a 1.800 tokens e a definição do toolset ~4.600, então o histórico é
 * podado (só as últimas capturas ficam inteiras) e, perto do teto, compactado
 * num resumo escrito pelo próprio Claude.
 *
 * A poda é a MESMA do motor do Chrome (troca a imagem velha por uma linha de
 * texto e deixa o par tool_use/tool_result intacto, que a API exige): reexportada,
 * não copiada.
 *
 * Puro.
 */

export { podarCapturas } from "../navegador/motor";

type Uso = RespostaClaudeDireto["usage"];

/** Tudo que a chamada consumiu (entrada, saída e cache), para o teto da tarefa. */
export function tokensDaResposta(u: Uso): number {
  return u.input_tokens + u.output_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
}

/** O tamanho do prompt desta chamada: é ele que cresce com o histórico. */
export function contextoDaResposta(u: Uso): number {
  return u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
}

export function precisaCompactar(u: Uso, contextoMax: number): boolean {
  return contextoDaResposta(u) >= contextoMax;
}

export function blocoDeImagem(img: { base64: string; mediaType: string }): BlocoClaude {
  return { type: "image", source: { type: "base64", media_type: img.mediaType, data: img.base64 } };
}

export const PEDIDO_DE_RESUMO =
  "Pare de agir por um instante. Escreva um resumo curto do progresso desta tarefa para você mesmo retomar: o que já foi feito, em que tela estamos, o que falta e qualquer coisa que o dono precise saber. Só texto, sem chamar nenhuma ferramenta.";

/**
 * O histórico depois de compactar: o objetivo, o resumo e a última captura. O
 * resumo é texto do PRÓPRIO Claude (que pode ter copiado coisa da tela): vai como
 * dado dentro de um bloco delimitado, não como ordem.
 */
export function recomecarComResumo(objetivo: string, resumo: string, ultima: { base64: string; mediaType: string } | null): MensagemClaude[] {
  const texto = `Objetivo: ${objetivo}\n\nO histórico foi compactado. Seu resumo do progresso até aqui (dado seu, não do dono):\n<resumo_do_progresso>\n${resumo.replaceAll("</resumo_do_progresso>", "").slice(0, 6000)}\n</resumo_do_progresso>\n\nA tela agora está na imagem. Continue de onde parou.`;
  return [{ role: "user", content: [{ type: "text", text: texto }, ...(ultima ? [blocoDeImagem(ultima)] : [])] }];
}

/** Os `tool_use` sem `tool_result` na mensagem seguinte: a API recusa o histórico assim. */
export function usosSemResultado(msgs: readonly MensagemClaude[]): string[] {
  const orfaos: string[] = [];
  msgs.forEach((m, i) => {
    if (m.role !== "assistant" || typeof m.content === "string") return;
    const seguinte = msgs[i + 1];
    const resultados = new Set(seguinte && seguinte.role === "user" && typeof seguinte.content !== "string" ? seguinte.content.filter((b) => b.type === "tool_result").map((b) => String(b.tool_use_id)) : []);
    for (const b of m.content) if (b.type === "tool_use" && !resultados.has(String(b.id))) orfaos.push(String(b.id));
  });
  return orfaos;
}
