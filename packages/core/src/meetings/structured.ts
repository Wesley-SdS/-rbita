import { generateText, type LanguageModel } from "ai";
import type { ZodType } from "zod";

/**
 * Extração de JSON estruturado, robusta a modelos LOCAIS pequenos.
 *
 * `generateObject` do AI SDK falhou em produção contra `qwen2.5:7b` via Ollama
 * (`AI_NoObjectGeneratedError: response did not match schema`) mesmo com uma
 * chamada simples — o endpoint OpenAI-compatible do Ollama não garante o modo
 * estruturado que o SDK espera. O mesmo modelo já funciona bem com TOOL CALLING
 * (é o que o chat usa), mas não com o modo de objeto do `generateObject`.
 *
 * Em vez de depender do provedor declarar suporte a saída estruturada, pedimos
 * JSON por PROMPT (funciona em qualquer provedor dos 7 que a Órbita suporta) e
 * fazemos o parse tolerante a cerca de código markdown e a texto antes/depois
 * do objeto, com UMA tentativa de reparo se o JSON vier inválido ou não bater
 * com o schema.
 */

/** Remove ```json ... ``` (ou ``` ... ```) ao redor do texto, se houver. */
export function stripJsonFences(text: string): string {
  const m = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(text.trim());
  return (m ? m[1] : text).trim();
}

/** Do primeiro `{` ao último `}` — corta prosa antes/depois do objeto. */
export function extractJsonSubstring(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start >= 0 && end > start ? text.slice(start, end + 1) : text;
}

/** Tenta interpretar `text` como JSON, tolerando cerca de código e prosa ao redor. */
export function tryParseJson(text: string): unknown | null {
  for (const candidate of [text, stripJsonFences(text), extractJsonSubstring(stripJsonFences(text))]) {
    try {
      return JSON.parse(candidate);
    } catch {
      continue;
    }
  }
  return null;
}

const JSON_INSTRUCTION =
  "\n\nResponda APENAS com um objeto JSON válido, sem texto antes ou depois, sem bloco de código markdown (sem ```). " +
  "Nada fora do objeto JSON.";

/**
 * Gera texto pedindo JSON e valida contra `schema`, com uma tentativa de
 * reparo se o resultado vier inválido (reenvia o erro ao modelo e pede para
 * corrigir). Lança erro claro se falhar mesmo depois do reparo.
 */
/**
 * `aoUsar` recebe o consumo de CADA chamada, inclusive a de reparo. Sem isto a
 * segunda tentativa ficava fora da conta da casa, e ela é justamente a que
 * acontece quando o modelo está indo mal — ou seja, a que mais custa.
 */
export type RelatoDeUso = (u: { inputTokens?: number; outputTokens?: number }) => void;

export async function generateStructured<T>(model: LanguageModel, prompt: string, schema: ZodType<T>, aoUsar?: RelatoDeUso): Promise<T> {
  const { text, usage } = await generateText({ model, prompt: prompt + JSON_INSTRUCTION });
  aoUsar?.(usage ?? {});
  const parsed = tryParseJson(text);
  const first = parsed !== null ? schema.safeParse(parsed) : undefined;
  if (first?.success) return first.data;

  // reparo: uma segunda chamada, mostrando o que veio e o que deu errado
  const motivo = parsed === null ? "o texto não é um JSON válido" : `o JSON não bate com o formato esperado: ${first?.error?.issues[0]?.message ?? "erro de validação"}`;
  const { text: text2, usage: usage2 } = await generateText({
    model,
    prompt: `Sua resposta anterior falhou porque ${motivo}.\n\nResposta anterior:\n${text.slice(0, 2000)}\n\nCorrija e responda de novo, só com o objeto JSON válido, sem texto antes ou depois e sem bloco de código.`,
  });
  aoUsar?.(usage2 ?? {});
  const parsed2 = tryParseJson(text2);
  const second = parsed2 !== null ? schema.safeParse(parsed2) : undefined;
  if (second?.success) return second.data;

  throw new Error(`generateStructured: resposta não é um JSON válido mesmo após reparo (${motivo})`);
}
