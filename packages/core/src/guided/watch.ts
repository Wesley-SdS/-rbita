import { eq } from "drizzle-orm";
import { db } from "@orbita/db";
import { guidedTask, type GuidedTask } from "@orbita/db/guided-schema";
import { camera } from "@orbita/db/camera-schema";
import { settings } from "../settings";
import { events } from "../events/index";
import { log } from "../observability/logger";
import { latestEventWithSnapshot } from "../cameras/query";
import { narrateSnapshot } from "../cameras/narrate";
import { activeGuidedTasks, expireGuidedTasks, stopGuidedTask } from "./task";
import { avancar, devoOlhar, lerVeredito, montarPergunta } from "./rules";

/**
 * O laço que de fato ACOMPANHA: olha a câmera do cômodo de tempos em tempos e
 * fala o próximo passo quando o atual terminou (PRD §5.4).
 *
 * Roda no processo persistente, uma tarefa de cada vez, porque cada olhada é
 * uma chamada a modelo de visão e nesta máquina isso é CPU (CLAUDE.md §9). A
 * regra de privacidade é a mesma da narração: câmera que identifica pessoas
 * responde só com modelo local (decisão 9.6), e isso vem de `narrateSnapshot`.
 */

async function avisar(t: GuidedTask, titulo: string, corpo: string): Promise<void> {
  // import dinâmico: `routines/run` carrega o motor de chat inteiro, e este
  // módulo roda num laço curto do scheduler
  const { notifyUser } = await import("../routines/run");
  await notifyUser(t.userId, titulo, corpo, null, { personId: t.personId }).catch((e) =>
    log.warn("guided.aviso_falhou", { taskId: t.id, error: e instanceof Error ? e.message : String(e) }),
  );
}

/** Uma olhada numa tarefa. Devolve o que foi decidido, para o log e o teste. */
export async function olharTarefa(t: GuidedTask): Promise<"sem_camera" | "sem_imagem" | "terminou" | "ainda_nao" | "nao_da_para_saber"> {
  if (!t.cameraId) return "sem_camera";
  const [cam] = await db.select().from(camera).where(eq(camera.id, t.cameraId)).limit(1);
  if (!cam || !cam.enabled) return "sem_camera";

  const ev = await latestEventWithSnapshot(cam.id);
  const agora = new Date();
  if (!ev?.snapshot) {
    // sem imagem nova não dá para decidir nada; marca a olhada para não ficar
    // tentando de novo a cada volta do laço
    await db.update(guidedTask).set({ lastLookAt: agora, updatedAt: agora }).where(eq(guidedTask.id, t.id));
    return "sem_imagem";
  }

  const cfg = await settings.getMany(["guided.question"]);
  const passo = t.steps[t.currentStep] ?? "";
  const pergunta = montarPergunta(cfg["guided.question"], passo, t.title);
  const resposta = await narrateSnapshot(ev.snapshot, pergunta, { localOnly: cam.identifyFaces });
  const veredito = lerVeredito(resposta);

  await db
    .update(guidedTask)
    .set({ lastLookAt: agora, lastObservation: resposta.trim().slice(0, 300), updatedAt: agora })
    .where(eq(guidedTask.id, t.id));

  if (veredito !== "terminou") return veredito;

  const proximo = avancar(t.steps, t.currentStep);
  await events.emit("guided.step", { taskId: t.id, titulo: t.title, passo: t.currentStep, total: t.steps.length, concluiu: proximo.concluiu }, { userId: t.userId }).catch(() => undefined);

  if (proximo.concluiu) {
    await stopGuidedTask(t.userId, t.id, "concluida");
    await avisar(t, t.title, "Terminou o último passo. Tarefa concluída.");
    return "terminou";
  }

  await db.update(guidedTask).set({ currentStep: proximo.proximo, updatedAt: new Date() }).where(eq(guidedTask.id, t.id));
  await avisar(t, t.title, `Passo ${proximo.proximo + 1} de ${t.steps.length}: ${proximo.texto}`);
  return "terminou";
}

/**
 * Uma volta do laço: fecha o que venceu e olha UMA tarefa devida (a mais
 * antiga sem olhar). Uma por volta, de propósito: duas câmeras narrando ao
 * mesmo tempo saturam a CPU e atrasam o chat.
 */
export async function tickGuidedTasks(): Promise<{ olhadas: number; expiradas: number }> {
  const expiradas = await expireGuidedTasks();
  const ativas = await activeGuidedTasks();
  const agora = new Date();
  const devida = ativas.find((t) => devoOlhar(t.lastLookAt, t.intervalSeconds, agora));
  if (!devida) return { olhadas: 0, expiradas };
  try {
    const r = await olharTarefa(devida);
    log.info("guided.olhada", { taskId: devida.id, resultado: r, passo: devida.currentStep });
  } catch (e) {
    // falha de modelo não pode derrubar o laço nem encerrar a tarefa: olha de novo
    log.warn("guided.olhada_falhou", { taskId: devida.id, error: e instanceof Error ? e.message : String(e) });
    await db.update(guidedTask).set({ lastLookAt: new Date() }).where(eq(guidedTask.id, devida.id)).catch(() => undefined);
  }
  return { olhadas: 1, expiradas };
}
