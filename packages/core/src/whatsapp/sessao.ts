import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@orbita/db";
import { waSessao, type WaSessao } from "@orbita/db/whatsapp-schema";
import { encryptSecret, decryptSecret } from "../crypto";
import { settings } from "../settings";
import { events } from "../events/index";
import { log } from "../observability/logger";
import * as ponte from "./gowa/client";
import { normalizarJid } from "./traduzir";
import { isLocalUrl } from "../privacy/egress";

/**
 * A sessão do WhatsApp pessoal: pareamento, saúde e o segredo do webhook.
 *
 * O `deviceId` registrado no GOWA é nosso (um uuid), não o que o GOWA
 * inventaria: assim o slot sobrevive a reinício do container e o `session_id`
 * que volta no webhook já é a nossa chave.
 */

export async function sessaoDe(userId: string): Promise<WaSessao | null> {
  const [s] = await db.select().from(waSessao).where(eq(waSessao.userId, userId)).limit(1);
  return s ?? null;
}

/** Para o webhook: quem é o dono deste dispositivo e com que segredo ele assina. */
export async function sessaoDoDispositivo(deviceId: string): Promise<{ sessao: WaSessao; segredo: string } | null> {
  const [s] = await db.select().from(waSessao).where(eq(waSessao.deviceId, deviceId)).limit(1);
  if (!s) return null;
  try {
    return { sessao: s, segredo: decryptSecret(s.webhookSegredoEnc) };
  } catch {
    // segredo cifrado com outra CONNECTORS_ENC_KEY: sem ele não há como
    // conferir a assinatura, e aceitar sem conferir não é opção
    log.error("whatsapp.segredo_ilegivel", { deviceId });
    return null;
  }
}

export async function urlDoWebhook(deviceId: string): Promise<string> {
  const base = (await settings.get("whatsapp.webhookBase")).replace(/\/+$/, "");
  // toda mensagem de terceiro viaja para este endereço: só dentro de casa
  if (!isLocalUrl(base)) throw new ponte.PonteError("O endereço da Órbita visto pela ponte precisa ser local.", "nao_local");
  return `${base}/api/whatsapp/webhook/${encodeURIComponent(deviceId)}`;
}

// O endereço do webhook que a ponte conhece, por dispositivo. Mudou em Ajustes
// (a api foi para outra porta, para um contêiner), a próxima volta da saúde
// reaponta: sem isto, as mensagens paravam de chegar até o dono parear de novo.
const webhookApontado = new Map<string, string>();
async function reapontarSeMudou(s: WaSessao): Promise<void> {
  const url = await urlDoWebhook(s.deviceId);
  if (webhookApontado.get(s.deviceId) === url) return;
  await ponte.apontarWebhook(s.deviceId, url, decryptSecret(s.webhookSegredoEnc));
  webhookApontado.set(s.deviceId, url);
}

/** Cria a linha e o slot no GOWA, se ainda não existirem. Idempotente. */
export async function garantirSessao(userId: string): Promise<WaSessao> {
  let s = await sessaoDe(userId);
  if (!s) {
    const segredo = randomBytes(32).toString("hex");
    [s] = await db
      .insert(waSessao)
      .values({ userId, deviceId: randomUUID(), webhookSegredoEnc: encryptSecret(segredo) })
      .onConflictDoNothing({ target: waSessao.userId })
      .returning();
    // corrida entre dois cliques: quem perdeu relê a linha de quem ganhou
    s ??= (await sessaoDe(userId))!;
  }
  const segredo = decryptSecret(s.webhookSegredoEnc);
  const url = await urlDoWebhook(s.deviceId);
  await ponte.criarDispositivo(s.deviceId, url, segredo);
  await ponte.apontarWebhook(s.deviceId, url, segredo);
  return s;
}

export async function parear(userId: string, modo: "qr" | "codigo", telefone?: string): Promise<ponte.Pareamento> {
  const s = await garantirSessao(userId);
  const p = modo === "codigo" ? await ponte.parearPorCodigo(s.deviceId, telefone ?? "") : await ponte.parearPorQr(s.deviceId);
  await db.update(waSessao).set({ status: "pareando", atualizadoEm: new Date() }).where(eq(waSessao.id, s.id));
  return p;
}

export async function desconectarSessao(userId: string): Promise<void> {
  const s = await sessaoDe(userId);
  if (!s) return;
  try {
    await ponte.desconectar(s.deviceId);
  } catch (e) {
    // Logout que falhou NÃO pode virar "desconectado" na tela: a ponte segue
    // logada, a próxima volta da saúde a vê conectada e a Órbita volta a ler e
    // responder num número que o dono acha que desligou. Só "já não estava
    // pareado" conta como sucesso.
    if (!(e instanceof ponte.PonteError && e.motivo === "sem_sessao")) throw e;
  }
  await db.update(waSessao).set({ status: "desconectado", jid: null, atualizadoEm: new Date() }).where(eq(waSessao.id, s.id));
  await events.emit("whatsapp.sessao_caiu", { motivo: "desconectado_pelo_dono" }, { userId });
}

export type StatusDaSessao = WaSessao["status"];

/**
 * Novo status a partir do que a ponte disse. PURA. Conectado só com as três
 * coisas (logado, conectado e com JID), como o workspace aprendeu: logado sem
 * conexão é sessão que caiu e ainda não voltou. `banido` nunca é desfeito
 * sozinho: só o dono, pareando de novo.
 */
export function proximoStatus(atual: StatusDaSessao, e: ponte.EstadoDaPonte | null): StatusDaSessao {
  if (atual === "banido") return "banido";
  if (!e) return atual === "pareando" ? "pareando" : "desconectado";
  if (e.logado && e.conectado && e.jid) return "conectado";
  if (atual === "pareando" && !e.logado) return "pareando";
  return "desconectado";
}

// Quedas seguidas vistas pela saúde, por dono (memória do processo: reiniciar
// zera, e isso só atrasa um aviso, nunca inventa um).
const quedasSeguidas = new Map<string, number>();
// A última queda foi da PONTE (GOWA fora), não do número: a volta não é reconexão.
const caiuPelaPonte = new Set<string>();

/**
 * Uma volta da saúde (laço do SchedulerService). Grava só quando MUDA e emite
 * `whatsapp.sessao_caiu` / `whatsapp.sessao_voltou`, que as regras do dono
 * podem transformar em aviso.
 *
 * Um timeout isolado não derruba nada: é preciso `whatsapp.saudeFalhasParaCair`
 * voltas seguidas sem conexão. Sem isso, cada soluço do GOWA virava um "o
 * WhatsApp caiu" seguido de "voltou" e inflava a contagem de reconexões.
 */
export async function conferirSaude(userId: string): Promise<StatusDaSessao | null> {
  const s = await sessaoDe(userId);
  if (!s) return null;
  await reapontarSeMudou(s).catch((err) => log.warn("whatsapp.webhook_nao_reapontado", { erro: err instanceof Error ? err.message : String(err) }));
  let e: ponte.EstadoDaPonte | null = null;
  try {
    e = await ponte.estado(s.deviceId);
  } catch (err) {
    // ponte fora do ar: o número pode estar bem, mas a Órbita não o alcança
    if (!(err instanceof ponte.PonteError) || err.motivo !== "sem_sessao") log.warn("whatsapp.saude_sem_ponte", { erro: err instanceof Error ? err.message : String(err) });
    else e = { conectado: false, logado: false, jid: null };
  }
  // o status de ANTES fica guardado: a linha pode ser a mesma que o update muda
  const anterior = s.status;
  const novo = proximoStatus(anterior, e);
  if (s.status === "conectado" && novo !== "conectado") {
    const n = (quedasSeguidas.get(userId) ?? 0) + 1;
    quedasSeguidas.set(userId, n);
    if (n < (await settings.get("whatsapp.saudeFalhasParaCair"))) return s.status;
  }
  quedasSeguidas.delete(userId);
  const jid = e?.jid ? normalizarJid(e.jid) : s.jid;
  if (novo === s.status && jid === s.jid) return novo;

  const voltou = novo === "conectado" && anterior !== "conectado";
  const reconexao = voltou && Boolean(s.pareadoEm) && !caiuPelaPonte.has(userId);
  if (voltou) caiuPelaPonte.delete(userId);
  await db
    .update(waSessao)
    .set({
      status: novo,
      jid,
      atualizadoEm: new Date(),
      ...(voltou && !s.pareadoEm ? { pareadoEm: new Date() } : {}),
      // só a segunda conexão em diante conta, e queda da ponte não é do número
      ...(reconexao ? { reconexoes: s.reconexoes + 1 } : {}),
    })
    .where(eq(waSessao.id, s.id));
  if (voltou) await events.emit("whatsapp.sessao_voltou", { jid }, { userId });
  else if (anterior === "conectado" && novo !== "conectado") {
    if (!e) caiuPelaPonte.add(userId);
    await events.emit("whatsapp.sessao_caiu", { motivo: e ? "desconectado" : "ponte_fora_do_ar" }, { userId });
  }
  log.info("whatsapp.status", { de: anterior, para: novo });
  return novo;
}

/** Donos com sessão (para o laço de saúde). */
export async function usuariosComSessao(): Promise<string[]> {
  return (await db.select({ userId: waSessao.userId }).from(waSessao)).map((r) => r.userId);
}

/** O número pessoal está pronto para mandar e receber? */
export async function pessoalConectado(userId: string): Promise<boolean> {
  const s = await sessaoDe(userId).catch(() => null);
  return s?.status === "conectado";
}
