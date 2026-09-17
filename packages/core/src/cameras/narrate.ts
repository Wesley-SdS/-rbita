import { generateText } from "ai";
import { eq } from "drizzle-orm";
import { resolveVisionModel } from "@orbita/llm";
import { db } from "@orbita/db";
import { cameraEvent } from "@orbita/db/camera-schema";

/**
 * Narra UM keyframe (nunca vídeo contínuo — briefing §7.1). Sob demanda por
 * padrão (decisão do dono): só roda quando alguém pergunta "o que está
 * acontecendo" ou uma regra pede explicitamente, nunca a cada evento.
 */
export async function narrateSnapshot(snapshot: string, question = "O que está acontecendo nesta cena? Descreva em uma ou duas frases."): Promise<string> {
  const { text } = await generateText({
    model: resolveVisionModel(),
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: `${question} Responda em português do Brasil.` },
          { type: "image", image: snapshot },
        ],
      },
    ],
  });
  return text.trim();
}

/** Narra e persiste na própria linha do evento (evita narrar o mesmo evento duas vezes). */
export async function narrateCameraEvent(eventId: string): Promise<string> {
  const [ev] = await db.select().from(cameraEvent).where(eq(cameraEvent.id, eventId)).limit(1);
  if (!ev) throw new Error("Evento de câmera não encontrado");
  if (ev.narration) return ev.narration;
  if (!ev.snapshot) throw new Error("Evento sem imagem para narrar");
  const narration = await narrateSnapshot(ev.snapshot);
  await db.update(cameraEvent).set({ narration, narratedAt: new Date() }).where(eq(cameraEvent.id, eventId));
  return narration;
}
