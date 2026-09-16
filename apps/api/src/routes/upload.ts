// Migrada do Next em paridade (apps/web/src/app/api/upload/route.ts).
import type { RouteCtx } from "../http/web";
import { sessionOf } from "../http/web-route";
import { ingestDocument } from "@orbita/core/rag/ingest";

/** Upload de arquivo (PDF / imagem-OCR / texto) → extrai texto → indexa (RAG). */
export async function POST(req: Request, ctx: RouteCtx) {
  const session = sessionOf(ctx);
  if (!session) return Response.json({ error: "Não autenticado" }, { status: 401 });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "Arquivo ausente" }, { status: 400 });

  const name = file.name || "arquivo";
  const type = file.type || "";
  const buf = Buffer.from(await file.arrayBuffer());

  let text = "";
  let source = "file";
  try {
    if (name.toLowerCase().endsWith(".pdf") || type === "application/pdf") {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(buf));
      const r = await extractText(pdf, { mergePages: true });
      text = Array.isArray(r.text) ? r.text.join("\n") : r.text;
      source = "pdf";
    } else if (type.startsWith("image/")) {
      const { ocrImage } = await import("@orbita/core/ocr");
      text = await ocrImage(buf);
      source = "ocr";
    } else {
      text = buf.toString("utf-8");
    }
  } catch (e) {
    return Response.json(
      { error: "Falha ao extrair texto: " + (e instanceof Error ? e.message : "erro") },
      { status: 400 },
    );
  }

  if (!text.trim()) return Response.json({ error: "Nenhum texto extraído do arquivo" }, { status: 400 });

  const res = await ingestDocument(session.user.id, name, text, source);
  return Response.json({ title: name, source, ...res });
}
