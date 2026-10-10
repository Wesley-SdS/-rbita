import { settings } from "../settings";
import { log } from "../observability/logger";
import { sessaoDe } from "./sessao";
import { normalizarJid } from "./traduzir";
import { enviarAudio, enviarTexto, enviarDocumento } from "./enviar";
import { registrarNoHistorico } from "./conversa";
import { agoraLocal, noSilencio } from "./horario";
import { chaveDoTelefone } from "../contatos/casar";

/**
 * A Órbita tomando a iniciativa pelo WhatsApp (item 1 da proativa): o aviso
 * que ela já gerava (push e lista de notificações) chega também na conversa
 * "Eu". Quem chama é `notifyUser`, então TODO aviso passa por aqui sem cada
 * fonte (regra, rotina, lembrete, reunião) precisar saber do WhatsApp.
 *
 * Nunca lança: aviso é fail-soft. O push continua saindo de qualquer jeito.
 */

// avisos mandados na hora corrente, por dono (memória do processo: reiniciar
// zera o teto, o que no pior caso deixa passar alguns avisos a mais)
const enviadosNaHora = new Map<string, { hora: string; n: number }>();

export interface OpcoesDoAviso {
  /** lembrete com hora marcado pelo dono: fura o silêncio (ele pediu aquela hora) */
  furaSilencio?: boolean;
  tipo?: "aviso" | "briefing";
}

export type ResultadoDoAviso = "enviado" | "desligado" | "sem_whatsapp" | "silencio" | "teto" | "falhou";

/**
 * Um arquivo para o PRÓPRIO dono, na conversa "Eu" ("me manda o extrato em
 * PDF"). Não passa pelo teto nem pelo silêncio dos avisos: foi ele que pediu,
 * agora. Devolve false sem WhatsApp pessoal conectado.
 */
export async function mandarArquivoAoDono(userId: string, arquivo: { bytes: Uint8Array; mime: string; nome: string }, legenda: string): Promise<boolean> {
  const sessao = await sessaoDe(userId);
  if (!sessao || sessao.status !== "conectado" || !sessao.jid) return false;
  // a conversa "Eu" é do próprio dono: aprovação humana por definição
  await enviarDocumento(userId, normalizarJid(sessao.jid), arquivo, legenda, { aprovacaoHumana: true });
  return true;
}

/**
 * Uma nota de voz para o PRÓPRIO dono, na conversa "Eu" ("me manda um áudio
 * falando dos meus e-mails"). Como o arquivo: foi ele que pediu, agora, e o
 * destino é fixado aqui, nunca pelo modelo. Devolve false sem WhatsApp pessoal.
 */
export async function mandarAudioAoDono(userId: string, texto: string): Promise<boolean> {
  const sessao = await sessaoDe(userId);
  if (!sessao || sessao.status !== "conectado" || !sessao.jid) return false;
  await enviarAudio(userId, normalizarJid(sessao.jid), texto, { aprovacaoHumana: true });
  return true;
}

/** O destino é o próprio dono? (com ou sem o nono dígito: a conta antiga do WhatsApp guarda sem) */
export async function ehOProprioDono(userId: string, jid: string): Promise<boolean> {
  const sessao = await sessaoDe(userId);
  if (!sessao?.jid) return false;
  const meu = normalizarJid(sessao.jid);
  if (meu === jid) return true;
  const numero = (j: string) => (j.endsWith("@s.whatsapp.net") ? j.split("@")[0]!.split(":")[0]! : "");
  return Boolean(numero(meu) && numero(jid)) && chaveDoTelefone(numero(meu)) === chaveDoTelefone(numero(jid));
}

export async function avisarNoWhatsapp(userId: string, titulo: string, corpo: string, opts: OpcoesDoAviso = {}): Promise<ResultadoDoAviso> {
  try {
    const tipo = opts.tipo ?? "aviso";
    const cfg = await settings.getMany(["whatsapp.avisos", "whatsapp.avisosSilencio", "whatsapp.avisosPorHora", "connectors.fusoHorario"]);
    if (tipo === "aviso" && cfg["whatsapp.avisos"] !== "todos") return "desligado";
    const sessao = await sessaoDe(userId);
    if (!sessao || sessao.status !== "conectado" || !sessao.jid) return "sem_whatsapp";

    const agora = agoraLocal(new Date(), cfg["connectors.fusoHorario"]);
    if (tipo === "aviso" && !opts.furaSilencio && noSilencio(cfg["whatsapp.avisosSilencio"], agora.minutos)) return "silencio";
    const hora = `${agora.dia}T${Math.floor(agora.minutos / 60)}`;
    const conta = enviadosNaHora.get(userId);
    const n = conta?.hora === hora ? conta.n : 0;
    if (tipo === "aviso" && n >= cfg["whatsapp.avisosPorHora"]) return "teto";
    // a vaga é RESERVADA antes do envio: os avisos saem sem esperar uns pelos
    // outros, e lendo a conta só depois do envio uma rajada inteira passava
    if (tipo === "aviso") enviadosNaHora.set(userId, { hora, n: n + 1 });

    // título, linha em branco e o corpo: colados, o aviso vira um bloco só no celular
    const texto = titulo.trim() ? `*${titulo.trim()}*\n\n${corpo.trim()}` : corpo.trim();
    try {
      // a conversa "Eu" é do próprio dono: aprovação humana por definição
      await enviarTexto(userId, normalizarJid(sessao.jid), texto.slice(0, 4000), { aprovacaoHumana: true });
    } catch (e) {
      const atual = enviadosNaHora.get(userId);
      if (tipo === "aviso" && atual?.hora === hora) enviadosNaHora.set(userId, { hora, n: Math.max(0, atual.n - 1) });
      throw e;
    }
    await registrarNoHistorico(userId, tipo, texto);
    return "enviado";
  } catch (e) {
    log.warn("whatsapp.aviso_falhou", { erro: e instanceof Error ? e.message : String(e) });
    return "falhou";
  }
}

/** Só para testes. */
export function _zerarTeto(): void {
  enviadosNaHora.clear();
}
