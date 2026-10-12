/**
 * IMAGEM PARA O MODELO (PRD F5): o screenshot (já mascarado nas mãos) chega ao
 * modelo que enxerga como imagem de verdade, pelo `toModelOutput` do AI SDK, e
 * não narrado em texto.
 *
 * A tool devolve `comImagem(dados, imagem)`. O registro (`toToolSet`) converte
 * na hora de montar a mensagem para o modelo:
 *   - modelo que enxerga (e a captura pode ir para ele): texto + imagem;
 *   - modelo que não enxerga, ou nuvem com `controle.capturaParaNuvem`
 *     desligado: só o texto, com a ALTERNATIVA que a tool mandou (a árvore de
 *     acessibilidade ou a narração), e a saída diz qual das duas foi usada.
 *
 * Os bytes da imagem nunca vão para a trilha, para o stream da tela nem para a
 * voz em tempo real (`semImagem`): só a miniatura opcional fica guardada.
 *
 * Puro.
 */
export const CHAVE_DA_IMAGEM = "imagem_para_modelo";

export interface ImagemParaModelo {
  /** base64 sem o prefixo `data:` */
  base64: string;
  mediaType: "image/png" | "image/jpeg" | "image/webp";
  /** o que vai no lugar da imagem quando o modelo não a recebe */
  alternativa: { tipo: "arvore" | "narracao"; texto: string };
  /** data URL pequena para a trilha e o cartão (só é gravada com `controle.guardarMiniaturas`) */
  miniatura?: string;
}

export type ComImagem<T extends Record<string, unknown>> = T & { [CHAVE_DA_IMAGEM]: ImagemParaModelo };

export function comImagem<T extends Record<string, unknown>>(dados: T, imagem: ImagemParaModelo): ComImagem<T> {
  return { ...dados, [CHAVE_DA_IMAGEM]: imagem };
}

function ehImagem(v: unknown): v is ImagemParaModelo {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  const alt = o.alternativa as Record<string, unknown> | undefined;
  return typeof o.base64 === "string" && typeof o.mediaType === "string" && !!alt && typeof alt.texto === "string";
}

/** A imagem que a saída carrega, se carrega. */
export function imagemDaSaida(output: unknown): ImagemParaModelo | null {
  if (!output || typeof output !== "object" || Array.isArray(output)) return null;
  const v = (output as Record<string, unknown>)[CHAVE_DA_IMAGEM];
  return ehImagem(v) ? v : null;
}

/** A saída sem os bytes da imagem, com a alternativa no lugar. Para quem não é o modelo que enxerga. */
export function semImagem(output: unknown): unknown {
  const img = imagemDaSaida(output);
  if (!img) return output;
  const { [CHAVE_DA_IMAGEM]: _fora, ...resto } = output as Record<string, unknown>;
  return { ...resto, visao_usada: img.alternativa.tipo, [img.alternativa.tipo]: img.alternativa.texto };
}

/**
 * A miniatura do cartão "Órbita no controle" (`{ controle: { miniatura } }`,
 * `controle/resumo.ts`) é para a TELA. Ia ao modelo como texto base64 (até
 * 200 KB por chamada, dezenas de milhares de tokens) e para a nuvem mesmo com
 * `controle.capturaParaNuvem` desligado (I10 da auditoria de 11/10/2026).
 * Devolve a saída sem ela e a miniatura à parte. Puro.
 */
export function separarMiniatura(output: unknown): { saida: unknown; miniatura: string | null } {
  if (!output || typeof output !== "object" || Array.isArray(output)) return { saida: output, miniatura: null };
  const o = output as Record<string, unknown>;
  const c = o.controle;
  if (!c || typeof c !== "object" || Array.isArray(c) || !("miniatura" in c)) return { saida: output, miniatura: null };
  const { miniatura, ...semMini } = c as Record<string, unknown>;
  return { saida: { ...o, controle: semMini }, miniatura: typeof miniatura === "string" && miniatura ? miniatura : null };
}

/** Devolve a miniatura ao cartão da tela (a voz recebe a saída já sem ela). Puro. */
export function comMiniatura(saida: unknown, miniatura: string | null | undefined): unknown {
  if (!miniatura || !saida || typeof saida !== "object" || Array.isArray(saida)) return saida;
  const o = saida as Record<string, unknown>;
  return o.controle && typeof o.controle === "object" ? { ...o, controle: { ...(o.controle as Record<string, unknown>), miniatura } } : saida;
}

type JSONValue = null | string | number | boolean | JSONValue[] | { [k: string]: JSONValue };

/** O formato `ToolResultOutput` do AI SDK (só os ramos que usamos). */
export type SaidaDoModelo =
  | { type: "text"; value: string }
  | { type: "json"; value: JSONValue }
  | { type: "content"; value: ({ type: "text"; text: string } | { type: "file"; data: { type: "data"; data: string }; mediaType: string })[] };

/**
 * Converte a saída da tool para o modelo. Sem imagem, é exatamente o que o AI
 * SDK faria sem `toModelOutput` (texto vira texto, o resto vira JSON), para
 * nenhuma tool antiga mudar de comportamento.
 */
export function saidaParaOModelo(bruta: unknown, enxerga: boolean): SaidaDoModelo {
  const output = separarMiniatura(bruta).saida;
  const img = imagemDaSaida(output);
  if (!img) return typeof output === "string" ? { type: "text", value: output } : { type: "json", value: (output ?? null) as JSONValue };
  if (!enxerga) return { type: "json", value: semImagem(output) as JSONValue };
  const { [CHAVE_DA_IMAGEM]: _fora, ...resto } = output as Record<string, unknown>;
  return {
    type: "content",
    value: [
      { type: "text", text: JSON.stringify({ ...resto, visao_usada: "imagem" }) },
      { type: "file", data: { type: "data", data: img.base64 }, mediaType: img.mediaType },
    ],
  };
}

/**
 * Este modelo deve receber a imagem? Só se enxerga, e se a captura puder ir à
 * nuvem quando ele não é local (`controle.capturaParaNuvem`). Puro.
 */
export function modeloRecebeImagem(info: { supportsVision?: boolean; local?: boolean } | undefined, capturaParaNuvem: boolean): boolean {
  if (!info?.supportsVision) return false;
  return info.local === true || capturaParaNuvem;
}
