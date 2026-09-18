import { settings } from "@orbita/core/settings/index";

/**
 * Lê o arquivo de um multipart e devolve como data URL, respeitando o teto
 * configurado. Com a fila, o arquivo espera na linha do trabalho até ele
 * terminar (e então é apagado), então o teto é obrigatório, não cortesia.
 */
export async function readUploadedFile(req: Request, faltando: string): Promise<{ dataUrl: string; nome: string; mime: string } | Response> {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return Response.json({ error: faltando }, { status: 400 });
  const maxMb = await settings.get("limits.uploadMaxMb");
  if (file.size > maxMb * 1024 * 1024) return Response.json({ error: `Arquivo maior que o limite de ${maxMb} MB.` }, { status: 413 });
  if (!file.size) return Response.json({ error: "Arquivo vazio." }, { status: 400 });
  const mime = file.type || "application/octet-stream";
  const b64 = Buffer.from(await file.arrayBuffer()).toString("base64");
  return { dataUrl: `data:${mime};base64,${b64}`, nome: (file.name || "arquivo").slice(0, 200), mime };
}
