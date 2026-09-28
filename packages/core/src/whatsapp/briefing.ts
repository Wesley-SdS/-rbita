import { eq } from "drizzle-orm";
import { db } from "@orbita/db";
import { waSessao } from "@orbita/db/whatsapp-schema";
import { settings } from "../settings";
import { log } from "../observability/logger";
import { notifyUser, runPromptForUser } from "../routines/run";
import { FLUXO } from "../usage/registrar";
import { agoraLocal, briefingDevido } from "./horario";
import { avisarNoWhatsapp } from "./avisar";
import { sessaoDe } from "./sessao";

/**
 * O briefing da manhã pelo WhatsApp (item 2 da proativa): agenda, contas da
 * semana, tarefas e quanto dá para gastar hoje, na conversa "Eu".
 *
 * Quem monta é a própria Órbita com as ferramentas de LEITURA (todas, sem a
 * seleção por relevância: sem um pedido do dono, a seleção pegaria as primeiras
 * na ordem de registro e o financeiro ficaria de fora). Leitura só: o briefing
 * roda sozinho, sem ninguém olhando, e não tem por que escrever nada.
 *
 * Um por dia: o dia do último envio fica em `wa_sessao.ultimo_briefing`, e é
 * gravado ANTES de mandar. Se o envio falhar, perde-se o briefing do dia;
 * gravar depois arriscaria mandar dois se o processo reiniciasse no meio.
 */
export type ResultadoDoBriefing = "enviado" | "fora_de_hora" | "sem_canal" | "falhou";

/**
 * O briefing vai para cada canal onde está DEVIDO: a conversa "Eu" do WhatsApp
 * e o Telegram da Órbita (se `telegram.briefing`). Montado UMA vez (uma chamada
 * de modelo), com o dia gravado em cada canal ANTES de mandar.
 */
export async function briefingSeDevido(userId: string, agora = new Date()): Promise<ResultadoDoBriefing> {
  const cfg = await settings.getMany(["whatsapp.briefingAtivo", "whatsapp.briefingHorario", "whatsapp.briefingDias", "whatsapp.briefingPedido", "telegram.briefing", "connectors.fusoHorario"]);
  const local = agoraLocal(agora, cfg["connectors.fusoHorario"]);
  const regra = { ativo: cfg["whatsapp.briefingAtivo"], horario: cfg["whatsapp.briefingHorario"], dias: cfg["whatsapp.briefingDias"] };

  const sessao = await sessaoDe(userId);
  const temWhatsapp = Boolean(sessao && sessao.status === "conectado");
  const tg = cfg["telegram.briefing"] ? await import("../telegram/store") : null;
  const [bot, donoTg] = tg ? await Promise.all([tg.botDe(userId), tg.donoNoTelegram(userId)]) : [null, null];
  const temTelegram = Boolean(bot && donoTg);
  if (!temWhatsapp && !temTelegram) return "sem_canal";

  const peloWhatsapp = temWhatsapp && briefingDevido(local, regra, sessao!.ultimoBriefing);
  const peloTelegram = temTelegram && briefingDevido(local, regra, bot!.ultimoBriefing);
  if (!peloWhatsapp && !peloTelegram) return "fora_de_hora";

  if (peloWhatsapp) await db.update(waSessao).set({ ultimoBriefing: local.dia }).where(eq(waSessao.id, sessao!.id));
  if (peloTelegram) await tg!.marcarBriefing(userId, local.dia);
  try {
    const texto = await runPromptForUser(userId, cfg["whatsapp.briefingPedido"], "\nVocê está montando o briefing da manhã, que vai por mensagem (WhatsApp ou Telegram). Responda só com o texto do briefing.", {
      fluxo: FLUXO.briefing,
      referencia: local.dia,
      soLeitura: true,
      todas: true,
    });
    let entregue = false;
    if (peloWhatsapp) entregue = (await avisarNoWhatsapp(userId, "Bom dia", texto, { tipo: "briefing" })) === "enviado" || entregue;
    if (peloTelegram) entregue = (await import("../telegram/enviar").then((m) => m.avisarNoTelegram(userId, "Bom dia", texto, { tipo: "briefing" }))) === "enviado" || entregue;
    if (entregue) return "enviado";
    // montou mas nenhum canal levou: o briefing do dia não se perde, fica no app
    await notifyUser(userId, "Bom dia", texto, null, { destino: "/app", whatsapp: false }).catch(() => undefined);
    return "falhou";
  } catch (e) {
    log.warn("whatsapp.briefing_falhou", { erro: e instanceof Error ? e.message : String(e) });
    // o dia já foi marcado (para não repetir); o dono sabe que hoje não teve
    await notifyUser(userId, "Briefing de hoje", "Não consegui montar o briefing desta manhã (nenhum modelo respondeu).", null, { destino: "/app", whatsapp: false }).catch(() => undefined);
    return "falhou";
  }
}
