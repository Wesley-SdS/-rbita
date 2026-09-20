import { generateText, stepCountIs } from "ai";
import { eq } from "drizzle-orm";
import { resolveModel, fallbackModelKey } from "@orbita/llm";
import { db } from "@orbita/db";
import { routine, notification } from "@orbita/db/routine-schema";
import { buildAllTools, SYSTEM_PROMPT } from "../chat/tools";
import { sendPush } from "../push/send";
import { settings } from "../settings";
import { applyLlmSettings } from "../settings/apply";
import { events } from "../events/index";
import { log } from "../observability/logger";

/**
 * Execução de rotinas (proatividade por intervalo).
 *
 * Saiu da rota /api/routines/run para poder ser chamada também pelo processo
 * persistente (apps/api), que é quem de fato roda isto agora. A rota continua
 * existindo para o botão "rodar agora"; o `setInterval` do navegador morreu.
 */

/** Cria uma notificação e dispara push (best-effort). */
export async function notifyUser(userId: string, title: string, body: string, routineId?: string | null, opts: { personId?: string | null; destino?: string | null } = {}): Promise<void> {
  await db.insert(notification).values({ userId, routineId: routineId ?? null, title, content: body, destino: opts.destino ?? null });
  // A VOZ SEGUE A PESSOA (Onda 12): quando o aviso é sobre alguém e essa pessoa
  // foi vista num cômodo com dispositivo, avisa ali. Sem isso, avisa em todos.
  const alvo = opts.personId ? await import("../identity/device").then((m) => m.deviceForPerson(userId, opts.personId!)).catch(() => null) : null;
  // O push abre onde o aviso aponta: tocar na notificação do celular e cair na
  // tela inicial obriga a pessoa a refazer o caminho que o aviso já sabia.
  void sendPush(userId, { title, body: body.slice(0, 180), url: opts.destino || "/app" }, { deviceId: alvo?.id ?? null });
  await events.emit("notification.created", { title, body: body.slice(0, 500), personId: opts.personId ?? null, deviceId: alvo?.id ?? null }, { userId });
}

/**
 * Pede uma resposta ao modelo com as ferramentas do usuário (é o mesmo motor
 * do chat, sem histórico). Usado por rotinas e por ações `prompt` das regras.
 */
export async function runPromptForUser(userId: string, prompt: string, systemSuffix = ""): Promise<string> {
  const [{ tools, cleanup, skillInstructions }, cfg] = await Promise.all([
    buildAllTools(userId),
    settings.getMany(["routines.model", "chat.maxSteps"]),
    applyLlmSettings(),
  ]);
  try {
    const modelKey = cfg["routines.model"].trim() || (await fallbackModelKey());
    const { text } = await generateText({
      model: resolveModel(modelKey),
      system: SYSTEM_PROMPT + skillInstructions + systemSuffix,
      prompt,
      tools,
      stopWhen: stepCountIs(cfg["chat.maxSteps"]),
    });
    return text?.trim() || "(sem conteúdo)";
  } finally {
    await cleanup(); // fecha conexões MCP
  }
}

const ROUTINE_SUFFIX = "\nVocê está executando uma rotina proativa. Produza um resultado útil e direto.";

/** Executa as rotinas devidas de UM usuário. `force` ignora o intervalo. */
export async function runDueRoutines(userId: string, opts: { force?: boolean } = {}): Promise<{ devidas: number; notificacoes: number }> {
  const rows = await db.select().from(routine).where(eq(routine.userId, userId));
  const now = Date.now();
  const due = rows.filter(
    (r) => r.enabled && (opts.force || !r.lastRunAt || now - r.lastRunAt.getTime() >= r.intervalMinutes * 60000),
  );
  let criadas = 0;
  for (const r of due) {
    try {
      const body = await runPromptForUser(userId, r.prompt, ROUTINE_SUFFIX);
      await notifyUser(userId, r.title, body, r.id);
      await db.update(routine).set({ lastRunAt: new Date() }).where(eq(routine.id, r.id));
      await events.emit("routine.finished", { routineId: r.id, title: r.title, resultado: body.slice(0, 500) }, { userId });
      criadas++;
    } catch (e) {
      // rotina que falha não derruba as outras
      log.warn("routines.falhou", { userId, routineId: r.id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { devidas: due.length, notificacoes: criadas };
}

/** Todos os usuários com rotinas ativas (o agendador roda para a casa inteira). */
export async function usersWithRoutines(): Promise<string[]> {
  const rows = await db.selectDistinct({ userId: routine.userId }).from(routine).where(eq(routine.enabled, true));
  return rows.map((r) => r.userId);
}
