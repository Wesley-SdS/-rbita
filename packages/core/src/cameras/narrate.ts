import { generateText } from "ai";
import { eq } from "drizzle-orm";
import { camera } from "@orbita/db/camera-schema";
import { resolveVisionModel } from "@orbita/llm";
import { db } from "@orbita/db";
import { cameraEvent } from "@orbita/db/camera-schema";

/**
 * Narra UM keyframe (nunca vídeo contínuo — briefing §7.1). Sob demanda por
 * padrão (decisão do dono): só roda quando alguém pergunta "o que está
 * acontecendo" ou uma regra pede explicitamente, nunca a cada evento.
 */
export async function narrateSnapshot(snapshot: string, question = "O que está acontecendo nesta cena? Descreva em uma ou duas frases.", opts: { localOnly?: boolean } = {}): Promise<string> {
  const { text } = await generateText({
    model: resolveVisionModel(opts),
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
  const [ev] = await db
    .select({ id: cameraEvent.id, snapshot: cameraEvent.snapshot, narration: cameraEvent.narration, identifica: camera.identifyFaces })
    .from(cameraEvent)
    .innerJoin(camera, eq(camera.id, cameraEvent.cameraId))
    .where(eq(cameraEvent.id, eventId))
    .limit(1);
  if (!ev) throw new Error("Evento de câmera não encontrado");
  if (ev.narration) return ev.narration;
  if (!ev.snapshot) throw new Error("Evento sem imagem para narrar");
  // decisão 9.6 (17/09): câmera que identifica pessoas narra só com modelo
  // local, mesmo com OPENAI_API_KEY configurada. Sem modelo local, não narra.
  const narration = await narrateSnapshot(ev.snapshot, undefined, { localOnly: ev.identifica });
  await db.update(cameraEvent).set({ narration, narratedAt: new Date() }).where(eq(cameraEvent.id, eventId));
  return narration;
}
