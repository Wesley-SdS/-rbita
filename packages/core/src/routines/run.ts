import { eq } from "drizzle-orm";
import { gerarTexto } from "../llm/gerar";
import { FLUXO } from "../usage/registrar";
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
export async function runPromptForUser(
  userId: string,
  prompt: string,
  systemSuffix = "",
  opts: { fluxo?: string; referencia?: string | null } = {},
): Promise<string> {
  const [{ tools, cleanup, skillInstructions }, cfg] = await Promise.all([
    buildAllTools(userId),
    settings.getMany(["routines.model", "chat.maxSteps"]),
    applyLlmSettings(),
  ]);
  try {
    // `gerarTexto` traz duas coisas que faltavam aqui: a CADEIA da casa (antes
    // era uma chave só, e com o Ollama desligado a rotina simplesmente
    // desistia) e o REGISTRO do consumo. Ver packages/core/src/llm/gerar.ts.
    const { texto } = await gerarTexto({
      userId,
      fluxo: opts.fluxo ?? FLUXO.rotina,
      referencia: opts.referencia,
      modeloPreferido: cfg["routines.model"],
      system: SYSTEM_PROMPT + skillInstructions + systemSuffix,
      prompt,
      tools,
      maxSteps: cfg["chat.maxSteps"],
    });
    return texto || "(sem conteúdo)";
  } finally {
    await cleanup(); // fecha conexões MCP
  }
}

const ROUTINE_SUFFIX = "\nVocê está executando uma rotina proativa. Produza um resultado útil e direto.";

/** O mínimo de uma rotina para decidir se ela roda agora. */
export interface RotinaAgendavel {
  enabled: boolean;
  lastRunAt: Date | null;
  intervalMinutes: number;
}

/**
 * Quais rotinas estão devidas agora. Pura, para o agendamento poder ser
 * testado sem banco: é a regra que decide se a Órbita vai gastar uma chamada
 * de modelo, então ela merece estar travada.
 *
 * O piso (`minimoMinutos`) é aplicado AQUI, e não só na hora de cadastrar, de
 * propósito: quem já está no banco com intervalo menor não pode continuar
 * correndo. Em 22/09/2026 uma rotina de "a cada 1 minuto" rodou 356 vezes, e
 * um piso só no cadastro teria deixado ela rodando para sempre.
 */
export function rotinasDevidas<T extends RotinaAgendavel>(rows: T[], agora: number, force = false, minimoMinutos = 0): T[] {
  return rows.filter((r) => {
    if (!r.enabled) return false;
    if (force) return true;
    if (!r.lastRunAt) return true;
    const intervalo = Math.max(r.intervalMinutes, minimoMinutos);
    return agora - r.lastRunAt.getTime() >= intervalo * 60000;
  });
}

/** Executa as rotinas devidas de UM usuário. `force` ignora o intervalo. */
export async function runDueRoutines(userId: string, opts: { force?: boolean } = {}): Promise<{ devidas: number; notificacoes: number }> {
  const rows = await db.select().from(routine).where(eq(routine.userId, userId));
  const minimo = await settings.get("routines.minIntervalMinutes").catch(() => 0);
  const due = rotinasDevidas(rows, Date.now(), opts.force, minimo);
  let criadas = 0;
  for (const r of due) {
    // A TENTATIVA já conta para o intervalo, dê certo ou não.
    //
    // Antes isto só era gravado no sucesso, e o efeito foi medido em
    // 22/09/2026: com o provedor fora do ar, duas rotinas continuavam
    // "devidas" em todo tique e tentavam de novo a cada 70 segundos, por
    // horas. Numa cadeia que chega à nuvem paga, isso é conta correndo
    // sozinha a noite inteira por uma rotina que é de hora em hora.
    //
    // O preço de fazer assim é que uma falha passageira adia a rotina por um
    // intervalo. Para trabalho periódico de casa, adiar é barato; repetir sem
    // limite, não.
    await db.update(routine).set({ lastRunAt: new Date() }).where(eq(routine.id, r.id));
    try {
      const body = await runPromptForUser(userId, r.prompt, ROUTINE_SUFFIX, { fluxo: FLUXO.rotina, referencia: r.title });
      await notifyUser(userId, r.title, body, r.id);
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
