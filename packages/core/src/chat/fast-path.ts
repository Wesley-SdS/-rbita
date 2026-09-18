import { eq } from "drizzle-orm";
import { db } from "@orbita/db";
import { haEntity, room } from "@orbita/db/home-schema";
import { listRegisteredTools } from "../tools/registry";

/**
 * CAMINHO RÁPIDO para comando da casa (B10.1).
 *
 * "Apaga a luz da sala" não precisa de RAG, persona, skills, servidores MCP nem
 * de 24 mensagens de histórico. Cada um desses custa tempo no turno, e para um
 * comando de casa a espera é o que mais incomoda. No caminho rápido o turno
 * leva só as tools do domínio casa e um histórico curto.
 *
 * Detectar sem lista chumbada: o vocabulário vem do que JÁ é dado.
 *   - verbos: keywords das tools da casa que AGEM ("liga", "apaga", "ajusta");
 *   - alvos: keywords das tools da casa de leitura ("luz", "temperatura"), os
 *     cômodos cadastrados e os nomes dos dispositivos do Home Assistant.
 * Precisa dos dois: "liga a luz da sala" é comando; "liga pro João" não é.
 * Errar para o lado do caminho normal é barato (só fica mais lento); errar
 * para o outro lado tiraria contexto de uma conversa, então a regra é estrita.
 */

export interface VocabularioDaCasa {
  verbos: string[];
  alvos: string[];
}

const normalizar = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** A frase contém o termo como palavra (ou expressão) inteira? */
function contem(frase: string, termo: string): boolean {
  const t = normalizar(termo);
  if (!t) return false;
  return ` ${frase} `.includes(` ${t} `);
}

/** É comando da casa que pode ir pelo caminho rápido? Puro. */
export function ehComandoDaCasa(texto: string, vocab: VocabularioDaCasa, maxChars: number): boolean {
  if (!texto.trim() || texto.length > maxChars) return false;
  const frase = normalizar(texto);
  const temVerbo = vocab.verbos.some((v) => contem(frase, v));
  if (!temVerbo) return false;
  return vocab.alvos.some((a) => contem(frase, a));
}

/** Monta o vocabulário a partir das tools e do cadastro da casa. Puro sobre as entradas. */
export function montarVocabulario(
  tools: readonly { domain: string; risk: string; keywords?: readonly string[] }[],
  comodos: readonly string[],
  entidades: readonly string[],
): VocabularioDaCasa {
  const daCasa = tools.filter((t) => t.domain === "casa");
  const verbos = new Set<string>();
  const alvos = new Set<string>();
  for (const t of daCasa) for (const k of t.keywords ?? []) (t.risk === "leitura" ? alvos : verbos).add(k);
  // uma palavra que é verbo não conta como alvo: senão "liga" sozinho bastaria
  for (const v of verbos) alvos.delete(v);
  for (const c of [...comodos, ...entidades]) if (c.trim()) alvos.add(c);
  return { verbos: [...verbos], alvos: [...alvos] };
}

// cache curto por dono: cômodos e dispositivos mudam raramente, e isto roda
// em toda mensagem
const cache = new Map<string, { em: number; vocab: VocabularioDaCasa }>();
const VALIDADE_MS = 60_000;

export async function vocabularioDaCasa(userId: string): Promise<VocabularioDaCasa> {
  const guardado = cache.get(userId);
  if (guardado && Date.now() - guardado.em < VALIDADE_MS) return guardado.vocab;
  const [comodos, entidades] = await Promise.all([
    db.select({ name: room.name }).from(room).where(eq(room.userId, userId)),
    db.select({ name: haEntity.friendlyName }).from(haEntity).where(eq(haEntity.userId, userId)),
  ]);
  const vocab = montarVocabulario(listRegisteredTools(), comodos.map((c) => c.name), entidades.map((e) => e.name));
  cache.set(userId, { em: Date.now(), vocab });
  return vocab;
}
