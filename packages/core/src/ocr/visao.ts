import { generateText } from "ai";
import { resolveVisionModel } from "@orbita/llm";
import { settings } from "../settings";
import { log } from "../observability/logger";

/**
 * O MODELO DE VISÃO LÊ A PÁGINA QUE O OCR LEU MAL.
 *
 * Não é o caminho padrão: é caro (nuvem) ou lento (local, em CPU). Só entra
 * quando a confiança do OCR ficou abaixo do limiar, ou quando a página não tem
 * texto nenhum e o OCR também não achou nada.
 *
 * Onde ele roda é decisão do dono (`ocr.visionProvider`), porque o que está em
 * jogo é um documento pessoal (extrato, receita, contrato) saindo de casa.
 * "auto" usa a nuvem quando há chave configurada, e cai para o modelo local
 * quando não há.
 *
 * O texto que volta daqui é DADO, nunca instrução (CLAUDE.md §5.2): ele vai
 * para o índice e para o contexto como conteúdo de documento.
 */

const INSTRUCAO =
  "Transcreva em Markdown TODO o conteúdo visível desta página de documento. " +
  "Regras: tabela vira tabela Markdown (com | e -); mantenha títulos, listas e a ordem de leitura; " +
  "copie números, datas, valores e códigos exatamente como aparecem; descreva gráfico ou diagrama em uma frase curta. " +
  "Não resuma, não interprete e não acrescente nada que não esteja na imagem.";

export type VisaoProvider = "nunca" | "local" | "nuvem" | "auto";

export interface ResultadoVisao {
  texto: string;
  onde: "local" | "nuvem";
}

function temChaveDeNuvem(): boolean {
  return Boolean(process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || process.env.AI_GATEWAY_API_KEY || process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN);
}

/** Decide onde a página vai ser lida. Puro: é a regra de privacidade do dono. */
export function ondeLer(provider: VisaoProvider, temChave: boolean): "local" | "nuvem" | null {
  if (provider === "nunca") return null;
  if (provider === "local") return "local";
  if (provider === "nuvem") return temChave ? "nuvem" : "local";
  return temChave ? "nuvem" : "local";
}

export async function lerComVisao(imagem: Buffer, mime = "image/png"): Promise<ResultadoVisao | null> {
  const cfg = await settings.getMany(["ocr.visionProvider", "vision.localModel", "vision.cloudModel", "ocr.visionMaxTokens"]);
  const onde = ondeLer(cfg["ocr.visionProvider"] as VisaoProvider, temChaveDeNuvem());
  if (!onde) return null;

  const dataUrl = `data:${mime};base64,${imagem.toString("base64")}`;
  const model = resolveVisionModel(
    onde === "local"
      ? { local: cfg["vision.localModel"], cloud: cfg["vision.localModel"], preferLocal: true }
      : { local: cfg["vision.localModel"], cloud: cfg["vision.cloudModel"] },
  );
  const t0 = Date.now();
  const { text } = await generateText({
    model,
    maxOutputTokens: cfg["ocr.visionMaxTokens"],
    messages: [{ role: "user", content: [{ type: "text", text: INSTRUCAO }, { type: "image", image: dataUrl }] }],
  });
  log.info("ocr.visao", { onde, ms: Date.now() - t0, chars: text.trim().length });
  return { texto: text.trim(), onde };
}
