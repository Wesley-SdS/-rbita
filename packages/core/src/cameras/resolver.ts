import type { Camera } from "@orbita/db/camera-schema";
import { findCamera, listCameras } from "./query";

/**
 * Achar a câmera que a pessoa quis dizer.
 *
 * A busca por nome (`ILIKE %texto%`) resolve "a câmera da garagem" e falha em
 * tudo que é dêitico. Medido em 22/09/2026: a câmera existia, chamada "Câmera
 * do notebook", o modelo pediu `local: "aqui"` — como a própria tool instrui —
 * e a busca não achou nada. A Órbita respondeu "nenhuma câmera foi encontrada"
 * com uma câmera cadastrada e um quadro recém-enviado.
 */

/** "aqui", "deste aparelho", "meu notebook": a pessoa quer a câmera de onde ela está. */
const AQUI = /\b(aqui|agora|este|esta|deste|desta|meu|minha|nesse|neste|aparelho|notebook|celular|tablet|webcam|computador|pc|laptop|camera|câmera)\b/i;

export function ehAqui(texto: string): boolean {
  const limpo = texto.normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
  if (!limpo) return true; // sem alvo nenhum, o alvo é onde a pessoa está
  return AQUI.test(limpo);
}

/**
 * A câmera do aparelho, entre as da casa. Puro.
 *
 * Reconhece pelo NOME porque é o que a criação automática usa ("Câmera do
 * notebook", "do celular", "do tablet"). Renomear quebra o reconhecimento por
 * nome, e é por isso que existe a regra do desempate abaixo.
 */
export function cameraDoAparelho<T extends { name: string }>(cams: T[]): T | null {
  const marca = /\b(aparelho|notebook|celular|tablet|webcam|laptop|computador)\b/i;
  return cams.find((c) => marca.test(c.name.normalize("NFD").replace(/[̀-ͯ]/g, ""))) ?? null;
}

/**
 * Qual câmera atende este pedido.
 *
 * A ordem importa: nome explícito ganha sempre. "A câmera do quarto da
 * Madalena" nunca deve cair na webcam do notebook por falta de correspondência
 * — responder sobre o lugar errado é pior do que dizer que não achou.
 */
export async function resolverCamera(userId: string, local: string): Promise<{ camera: Camera | null; total: number }> {
  const porNome = await findCamera(userId, local);
  const todas = await listCameras(userId);
  if (porNome) return { camera: porNome, total: todas.length };

  // Só caímos para a do aparelho quando o pedido é sobre "aqui". Um nome de
  // lugar que não existe continua sendo "não achei".
  if (!ehAqui(local)) return { camera: null, total: todas.length };

  const ligadas = todas.filter((c) => c.enabled);
  const doAparelho = cameraDoAparelho(ligadas);
  if (doAparelho) return { camera: doAparelho, total: todas.length };
  // uma câmera só na casa: "aqui" não tem outra coisa que possa querer dizer
  if (ligadas.length === 1) return { camera: ligadas[0]!, total: todas.length };
  return { camera: null, total: todas.length };
}
