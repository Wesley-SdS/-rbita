import { createHash } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { settings } from "../settings";

/**
 * Mídia do WhatsApp em DISCO LOCAL, não no banco nem em bucket: é dado pessoal
 * de terceiros, fica em casa. Deduplicada por sha256 (o mesmo meme recebido em
 * cinco grupos é um arquivo só), no formato `<aa>/<sha>.<ext>` do workspace.
 *
 * O banco guarda o caminho RELATIVO à pasta: trocar a pasta na config e mover
 * os arquivos continua funcionando.
 */

const EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/wav": "wav",
  "video/mp4": "mp4",
  "application/pdf": "pdf",
};

export function extensaoDe(mime: string): string {
  const base = mime.split(";")[0].trim().toLowerCase();
  return EXT[base] ?? (base.split("/")[1]?.replace(/[^a-z0-9]/g, "").slice(0, 8) || "bin");
}

export async function pastaDaMidia(): Promise<string> {
  const configurada = (await settings.get("whatsapp.midiaDir")).trim();
  return configurada ? path.resolve(configurada) : path.resolve(process.env.ORBITA_DATA_DIR ?? path.join(process.cwd(), "data"), "whatsapp");
}

/** Caminho absoluto de um relativo, recusando fuga da pasta ("../"). */
export async function caminhoAbsoluto(relativo: string): Promise<string> {
  const pasta = await pastaDaMidia();
  const abs = path.resolve(pasta, relativo);
  if (abs !== pasta && !abs.startsWith(pasta + path.sep)) throw new Error("Caminho de mídia fora da pasta do WhatsApp.");
  return abs;
}

export async function salvarMidia(bytes: Uint8Array, mime: string): Promise<{ caminho: string; sha256: string }> {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const relativo = path.join(sha256.slice(0, 2), `${sha256}.${extensaoDe(mime)}`);
  const abs = await caminhoAbsoluto(relativo);
  const existe = await stat(abs).then(() => true, () => false);
  if (!existe) {
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, bytes);
  }
  return { caminho: relativo.replace(/\\/g, "/"), sha256 };
}

export async function lerMidia(relativo: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(await caminhoAbsoluto(relativo)));
}

export async function apagarMidias(relativos: readonly string[]): Promise<void> {
  for (const r of relativos) await rm(await caminhoAbsoluto(r), { force: true }).catch(() => undefined);
}
