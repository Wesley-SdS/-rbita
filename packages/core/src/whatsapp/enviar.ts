import { paraWhatsapp } from "./markdown";
import { settings } from "../settings";
import { log } from "../observability/logger";
import { sendWhatsApp, whatsappConfigured as cloudConfigurada } from "../connectors/whatsapp";
import { paraNotaDeVoz, sintetizarFala } from "../voice/sintetizar";
import * as ponte from "./gowa/client";
import { decidirEnvio } from "./regras";
import { normalizarJid, numeroDoJid } from "./traduzir";
import { pessoalConectado, sessaoDe } from "./sessao";
import { lerMidia, salvarMidia } from "./midia";
import * as store from "./store";

/**
 * TODA saída de WhatsApp passa por aqui: tool aprovada, frase "manda",
 * resposta na conversa "Eu" e resposta automática. É por ser um caminho só que
 * o antibanimento e o reconhecimento do eco valem sem exceção (armadilha "tool
 * antiga, regra nova" do CLAUDE.md §9: `enviar_whatsapp` também passa aqui).
 */

export type Provedor = "pessoal" | "cloud";

/**
 * A ponte não respondeu a tempo DEPOIS de receber o envio: a mensagem pode ter
 * saído. Tratar como falha levava o dono a mandar de novo (duas mensagens), e
 * apagar a linha da saída fazia o eco voltar como mensagem nova do dono (na
 * conversa "Eu", a Órbita respondendo a si mesma). A linha fica; o eco, se
 * vier, casa com ela.
 */
export class EnvioIncerto extends Error {
  constructor() {
    super("Talvez tenha saído: o WhatsApp demorou a confirmar o envio. Confira a conversa antes de mandar de novo.");
    this.name = "EnvioIncerto";
  }
}

/** Falha do envio: incerta mantém a linha (o eco ainda pode chegar), as outras desfazem. */
async function falhouAoEnviar(userId: string, linha: string, e: unknown): Promise<never> {
  if (e instanceof ponte.PonteError && e.motivo === "tempo") throw new EnvioIncerto();
  await store.desfazerSaida(userId, linha);
  throw e;
}

export class EnvioRecusado extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvioRecusado";
  }
}

/** Escolha do provedor, PURA. `auto` prefere o número pessoal pareado. */
export function escolherProvedor(config: string, pessoal: boolean, cloud: boolean): Provedor | null {
  if (config === "pessoal") return pessoal ? "pessoal" : null;
  if (config === "cloud") return cloud ? "cloud" : null;
  return pessoal ? "pessoal" : cloud ? "cloud" : null;
}

export async function provedorAtivo(userId: string): Promise<Provedor | null> {
  const [config, pessoal, cloud] = await Promise.all([settings.get("whatsapp.provedor"), pessoalConectado(userId), cloudConfigurada(userId).catch(() => false)]);
  return escolherProvedor(config, pessoal, cloud);
}

/** Há algum WhatsApp pronto? É o `requires.whatsapp` das tools. */
export async function whatsappDisponivel(userId: string): Promise<boolean> {
  return (await provedorAtivo(userId)) !== null;
}

/** Só o número pessoal lê conversas: as tools de leitura exigem isto. */
export async function leituraDisponivel(userId: string): Promise<boolean> {
  return (await provedorAtivo(userId)) === "pessoal";
}

export interface OpcoesDeEnvio {
  /** um humano aprovou ESTE envio (é o que libera a abordagem fria) */
  aprovacaoHumana: boolean;
  /** saiu sozinho, pelo modo automático */
  automatica?: boolean;
  citando?: string | null;
}

export interface Enviado {
  provedor: Provedor;
  id: string;
  para: string;
}

/** Destino: um JID de chat conhecido ou um número (com DDI). */
export function jidDoDestino(destino: string): string {
  return normalizarJid(destino.includes("@") ? destino : destino.replace(/\D/g, ""));
}

async function prepararPessoal(userId: string, paraJid: string, opts: OpcoesDeEnvio) {
  const sessao = await sessaoDe(userId);
  if (!sessao || sessao.status !== "conectado") throw new EnvioRecusado("O WhatsApp pessoal não está conectado.");
  const contato = (await store.contatoPorJid(userId, paraJid)) ?? (await store.garantirContato(userId, paraJid, { grupo: paraJid.endsWith("@g.us") }));
  const cfg = await settings.getMany(["whatsapp.envioPorMinuto", "whatsapp.envioPorDia"]);
  const agora = Date.now();
  const [minuto, dia] = await Promise.all([store.enviadasDesde(userId, new Date(agora - 60_000)), store.enviadasDesde(userId, new Date(agora - 86_400_000))]);
  // a conversa "Eu" é do próprio dono: nunca é abordagem fria
  const proprio = sessao.jid !== null && normalizarJid(sessao.jid) === paraJid;
  const decisao = decidirEnvio(
    { contatoEscreveu: contato.escreveuAlgumaVez || proprio, aprovacaoHumana: opts.aprovacaoHumana, enviadasUltimoMinuto: minuto, enviadasUltimas24h: dia },
    { porMinuto: cfg["whatsapp.envioPorMinuto"], porDia: cfg["whatsapp.envioPorDia"] },
  );
  if (!decisao.ok) {
    log.warn("whatsapp.envio_recusado", { motivo: decisao.motivo });
    throw new EnvioRecusado(decisao.mensagem);
  }
  return { sessao, contato };
}

export async function enviarTexto(userId: string, destino: string, textoDoModelo: string, opts: OpcoesDeEnvio): Promise<Enviado> {
  // markdown do modelo no formato do WhatsApp, ANTES de registrar a saída: o
  // eco volta com o texto que de fato saiu, e é por ele que é casado
  const texto = paraWhatsapp(textoDoModelo);
  const provedor = await provedorAtivo(userId);
  if (!provedor) throw new EnvioRecusado("Nenhum WhatsApp conectado.");
  const paraJid = jidDoDestino(destino);

  if (provedor === "cloud") {
    const numero = numeroDoJid(paraJid);
    if (!numero) throw new EnvioRecusado("A Cloud API só manda para número de telefone, não para grupo.");
    const r = await sendWhatsApp(userId, numero, texto);
    return { provedor, id: r.id, para: numero };
  }

  const { sessao, contato } = await prepararPessoal(userId, paraJid, opts);
  // a linha nasce ANTES do envio: o eco pode voltar pelo webhook antes de o
  // GOWA devolver o id, e é por ela que ele é reconhecido
  const linha = await store.registrarSaida(userId, contato.id, paraJid, "texto", texto, Boolean(opts.automatica), { respondeA: opts.citando ?? null });
  try {
    const id = await ponte.enviarTexto(sessao.deviceId, paraJid, texto, opts.citando);
    await store.confirmarSaida(userId, linha, id);
    return { provedor, id, para: paraJid };
  } catch (e) {
    return falhouAoEnviar(userId, linha, e);
  }
}

/** Nota de voz com a voz da Órbita. Só no número pessoal (a Cloud API aqui é só texto). */
export async function enviarAudio(userId: string, destino: string, texto: string, opts: OpcoesDeEnvio): Promise<Enviado> {
  if ((await provedorAtivo(userId)) !== "pessoal") throw new EnvioRecusado("Áudio só pelo WhatsApp pessoal.");
  const paraJid = jidDoDestino(destino);
  const { sessao, contato } = await prepararPessoal(userId, paraJid, opts);

  // a MESMA voz da conversa em tempo real (Gemini, `realtime.geminiVoice`): a
  // nota de voz saía pelo Edge, uma voz diferente, e o dono estranhou
  const voz = await settings.getMany(["whatsapp.vozDaNota", "realtime.geminiVoice", "whatsapp.notaSoComAVozDaOrbita", "whatsapp.vozTentativas"]);
  const daOrbita = voz["whatsapp.vozDaNota"] === "igual_tempo_real";
  // nota de voz ninguém espera ao vivo: melhor tentar de novo do que mandar com
  // outra voz; sem a voz dela, quem chama decide (o bom dia vai em texto)
  const fala = await sintetizarFala(texto, {
    userId,
    preferirGemini: daOrbita,
    vozGemini: voz["realtime.geminiVoice"],
    ...(daOrbita && voz["whatsapp.notaSoComAVozDaOrbita"] ? { soAVozPreferida: { tentativas: voz["whatsapp.vozTentativas"] } } : {}),
  });
  let audio: { bytes: Uint8Array; mime: string } = fala;
  try {
    audio = await paraNotaDeVoz(fala);
  } catch (e) {
    // sem conversão ainda sai áudio, só que como anexo em vez de nota de voz
    log.warn("whatsapp.nota_de_voz_sem_conversao", { erro: e instanceof Error ? e.message : String(e) });
  }
  const { caminho } = await salvarMidia(audio.bytes, audio.mime);
  // o que foi DITO fica na transcrição: "o que a Órbita mandou para a Maria?" tem resposta
  const linha = await store.registrarSaida(userId, contato.id, paraJid, "audio", null, Boolean(opts.automatica), { midiaCaminho: caminho, midiaMime: audio.mime, respondeA: opts.citando ?? null });
  await store.atualizarMensagemPorId(userId, linha, { transcricao: texto });
  try {
    const id = await ponte.enviarMidia(sessao.deviceId, paraJid, "audio", audio.bytes, audio.mime.split(";")[0], audio.mime.startsWith("audio/ogg") ? "orbita.ogg" : "orbita.mp3");
    await store.confirmarSaida(userId, linha, id);
    return { provedor: "pessoal", id, para: paraJid };
  } catch (e) {
    return falhouAoEnviar(userId, linha, e);
  }
}

/**
 * Um ARQUIVO que a Órbita gerou (o extrato em PDF, por exemplo) como documento.
 * Só no número pessoal: a Cloud API aqui é só texto. Registra a saída antes de
 * mandar, como a imagem, para o eco não voltar como pedido do dono.
 */
export async function enviarDocumento(userId: string, destino: string, arquivo: { bytes: Uint8Array; mime: string; nome: string }, legenda: string | null, opts: OpcoesDeEnvio): Promise<Enviado> {
  if ((await provedorAtivo(userId)) !== "pessoal") throw new EnvioRecusado("Documento só pelo WhatsApp pessoal.");
  const paraJid = jidDoDestino(destino);
  const { sessao, contato } = await prepararPessoal(userId, paraJid, opts);
  const linha = await store.registrarSaida(userId, contato.id, paraJid, "documento", legenda, Boolean(opts.automatica), { midiaMime: arquivo.mime });
  try {
    const id = await ponte.enviarMidia(sessao.deviceId, paraJid, "document", arquivo.bytes, arquivo.mime, arquivo.nome, legenda);
    await store.confirmarSaida(userId, linha, id);
    return { provedor: "pessoal", id, para: paraJid };
  } catch (e) {
    return falhouAoEnviar(userId, linha, e);
  }
}

/** Reenvia uma imagem que a Órbita tem guardada (recebida ou mandada na conversa "Eu"). */
export async function enviarImagem(userId: string, destino: string, mensagemId: string, legenda: string | null, opts: OpcoesDeEnvio): Promise<Enviado> {
  if ((await provedorAtivo(userId)) !== "pessoal") throw new EnvioRecusado("Imagem só pelo WhatsApp pessoal.");
  const origem = await store.mensagemPorId(userId, mensagemId);
  if (!origem || origem.tipo !== "imagem" || !origem.midiaCaminho) throw new EnvioRecusado("Não encontrei essa imagem guardada.");
  const paraJid = jidDoDestino(destino);
  const { sessao, contato } = await prepararPessoal(userId, paraJid, opts);
  const bytes = await lerMidia(origem.midiaCaminho);
  const mime = origem.midiaMime ?? "image/jpeg";
  const linha = await store.registrarSaida(userId, contato.id, paraJid, "imagem", legenda, Boolean(opts.automatica), { midiaCaminho: origem.midiaCaminho, midiaMime: mime });
  try {
    const id = await ponte.enviarMidia(sessao.deviceId, paraJid, "image", bytes, mime, "imagem." + (mime.split("/")[1] ?? "jpg"), legenda);
    await store.confirmarSaida(userId, linha, id);
    return { provedor: "pessoal", id, para: paraJid };
  } catch (e) {
    return falhouAoEnviar(userId, linha, e);
  }
}
