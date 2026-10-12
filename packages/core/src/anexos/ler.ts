import { and, desc, eq, lt, ne } from "drizzle-orm";
import { db } from "@orbita/db";
import { anexoLido, type AnexoLido } from "@orbita/db/anexo-schema";
import { settings } from "../settings";
import { log } from "../observability/logger";
import { extrairIsolado } from "../arquivos/isolado";
import { partesDoTexto, resumoParaOModelo, tamanhoLegivel } from "../arquivos/texto";
import type { Extraido, Progresso } from "../arquivos/tipos";
import { embrulharDadoExterno } from "../texto/dado-externo";
import { acharLinhaNoTexto } from "../finance/boleto";
import { baixarAnexo, contaDaConexao, escolherAnexo, lerEmail, type AnexoInfo, type ContaDoEmail, type EmailCompleto, type Servico } from "./email";
import { marcarSenhasUsadas, senhasDoRemetente } from "./senhas";

/**
 * Abrir o anexo (PRD de anexos, C2): baixa, passa pelo extrator universal e
 * guarda o texto em `anexo_lido`, para a segunda pergunta ser instantânea.
 *
 * Arquivo demorado (OCR de 80 páginas, áudio de meia hora) não prende a
 * resposta: espera até `anexos.esperarSeg` e, se não acabou, a leitura segue
 * em segundo plano e a fila (`anexo.ler`) a acompanha e avisa quando
 * terminar. É a regra do CLAUDE.md §6: trabalho de mais de ~10 s não roda na
 * requisição.
 */

export interface LeituraDoAnexo {
  email: { id: string; assunto: string; de: string; conta: string; servico: Servico };
  anexo: { id: string; nome: string; tipo_declarado: string; tamanho: string };
  /** "lido", "em_andamento" (foi para a fila), "nao_lido" (tipo, tamanho, senha, link) */
  estado: "lido" | "em_andamento" | "nao_lido";
  tipo?: string;
  familia?: string;
  resumo: string;
  avisos?: string[];
  /** o texto, embrulhado como dado de terceiro (§5.2) */
  conteudo?: string;
  parte?: number;
  partes?: number;
  estruturado?: unknown;
  arquivos?: unknown;
  boleto?: { valor: number; vencimento: string | null; linha: string; beneficiario: string | null };
  protegido?: boolean;
  link?: string;
  do_cache?: boolean;
  dica?: string;
}

const reais = (centavos: number) => centavos / 100;

function hojeLocal(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: process.env.TZ || "America/Sao_Paulo" });
}

/** Detalhes que voltam do cache como vieram da primeira leitura. */
interface Detalhes {
  avisos?: string[];
  estruturado?: unknown;
  arquivos?: unknown;
  protegido?: boolean;
  /** a leitura FALHOU: vale até `ate` e enquanto a config tiver esta assinatura (I3) */
  falha?: { ate: string; config: string };
}

/** A linha digitável num texto, para o modelo poder propor "cadastrar este boleto". PURO. */
export function boletoNoTexto(texto: string, hoje = hojeLocal()): LeituraDoAnexo["boleto"] | undefined {
  const achado = acharLinhaNoTexto(texto, hoje);
  if (!achado) return undefined;
  return { valor: reais(achado.leitura.valor), vencimento: achado.leitura.vencimento, linha: achado.linha, beneficiario: achado.beneficiario };
}

/**
 * Assunto, remetente e nome do arquivo são escritos por quem MANDOU o e-mail:
 * vão embrulhados como dado, igual ao conteúdo (O6 da revisão). Um assunto
 * "IGNORE AS INSTRUÇÕES…" fora do embrulho chegava ao modelo como texto solto.
 */
function cabecalho(email: EmailCompleto, anexo: AnexoInfo): Pick<LeituraDoAnexo, "email" | "anexo"> {
  return {
    email: { id: email.id, assunto: embrulharDadoExterno("email", email.assunto), de: embrulharDadoExterno("email", email.de), conta: email.conta, servico: email.servico },
    anexo: { id: anexo.id, nome: embrulharDadoExterno("anexo", anexo.nome), tipo_declarado: anexo.tipo, tamanho: tamanhoLegivel(anexo.tamanho) },
  };
}

/** Monta a resposta a partir do texto lido (de agora ou do cache), cortando na parte pedida. */
export function resposta(base: Pick<LeituraDoAnexo, "email" | "anexo">, lido: { texto: string; resumo: string; tipo: string; familia: string; detalhes: Detalhes }, parte: number, caracteresMax: number, doCache: boolean): LeituraDoAnexo {
  const pedacos = lido.texto ? partesDoTexto(lido.texto, caracteresMax) : [];
  const n = Math.min(Math.max(1, parte), Math.max(1, pedacos.length));
  const boleto = lido.texto ? boletoNoTexto(lido.texto) : undefined;
  const nf = (lido.detalhes.estruturado as { tipo?: string } | undefined)?.tipo === "nota_fiscal";
  const evento = (lido.detalhes.estruturado as { tipo?: string } | undefined)?.tipo === "agenda";
  const dica = [
    pedacos.length > n ? `Há mais texto: peça parte=${n + 1} (de ${pedacos.length}).` : null,
    boleto ? "Parece um boleto: para cadastrar a conta, use usar_anexo com como=\"boleto\" (passa pela aprovação do dono)." : null,
    nf ? "É uma nota fiscal: para lançar a compra, use usar_anexo com como=\"cupom\"." : null,
    evento ? "É um convite: para pôr na agenda, use criar_evento com os dados do evento." : null,
  ].filter(Boolean).join(" ");
  // o que veio de DENTRO do arquivo fora do texto (títulos e descrição do convite, emitente da nota,
  // nomes dentro do ZIP, título do MHT, nomes das abas) também é de terceiro: vai embrulhado, como o conteúdo (O6, I2)
  return {
    ...base,
    estado: lido.texto ? "lido" : "nao_lido",
    tipo: lido.tipo,
    familia: lido.familia,
    resumo: resumoParaOModelo({ resumo: lido.resumo, familia: lido.familia, estruturado: lido.detalhes.estruturado, arquivos: lido.detalhes.arquivos }),
    ...(lido.detalhes.avisos?.length ? { avisos: lido.detalhes.avisos } : {}),
    ...(pedacos.length ? { conteudo: embrulharDadoExterno("anexo", pedacos[n - 1]!), parte: n, partes: pedacos.length } : {}),
    ...(lido.detalhes.estruturado ? { estruturado: embrulharDadoExterno("anexo", JSON.stringify(lido.detalhes.estruturado)) } : {}),
    ...(lido.detalhes.arquivos ? { arquivos: embrulharDadoExterno("anexo", JSON.stringify(lido.detalhes.arquivos)) } : {}),
    ...(boleto ? { boleto } : {}),
    ...(lido.detalhes.protegido ? { protegido: true } : {}),
    ...(doCache ? { do_cache: true } : {}),
    ...(dica ? { dica } : {}),
  };
}

async function doCache(userId: string, conexaoId: string, mensagemId: string, anexoId: string): Promise<AnexoLido | null> {
  const [row] = await db.select().from(anexoLido).where(and(eq(anexoLido.userId, userId), eq(anexoLido.conexaoId, conexaoId), eq(anexoLido.mensagemId, mensagemId), eq(anexoLido.anexoId, anexoId))).limit(1);
  return row ?? null;
}

/** Só uma leitura que DEU CERTO vale para outro e-mail com os mesmos bytes: a falha de um não se espalha (I3). */
async function porHash(userId: string, sha256: string): Promise<AnexoLido | null> {
  const [row] = await db.select().from(anexoLido).where(and(eq(anexoLido.userId, userId), eq(anexoLido.sha256, sha256), ne(anexoLido.texto, ""))).orderBy(desc(anexoLido.lidoEm)).limit(1);
  return row ?? null;
}

function detalhesDe(ex: Extraido): Detalhes {
  return {
    ...(ex.avisos.length ? { avisos: ex.avisos } : {}),
    ...(ex.estruturado ? { estruturado: ex.estruturado } : {}),
    ...(ex.arquivos?.length ? { arquivos: ex.arquivos } : {}),
  };
}

/**
 * O que, na config, muda o resultado de uma leitura que FALHOU: os tetos, a
 * transcrição, o OCR, o tempo e a memória de uma leitura, e se o 7-Zip está
 * instalado (instalar não muda a config, muda o disco). A falha guardada só
 * vale enquanto isto for igual (I3).
 */
export async function assinaturaDaConfig(): Promise<string> {
  const { limitesDaConfig } = await import("../arquivos/extrair");
  const { localizar7Zip } = await import("../arquivos/leitores/compactado");
  const [limites, outros] = await Promise.all([limitesDaConfig(), settings.getMany(["anexos.tetoDaLeituraSeg", "anexos.memoriaDaLeituraMb", "ocr.enabled"])]);
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(JSON.stringify({ limites, outros, seteZip: Boolean(localizar7Zip(limites.seteZip)) })).digest("hex").slice(0, 16);
}

/**
 * A linha guardada ainda vale? A leitura que deu certo vale até a retenção. A
 * que FALHOU vale só por `anexos.falhaGuardarMin` e enquanto a config for a
 * mesma: antes qualquer `lido: false` (o 7-Zip que faltava, a transcrição
 * desligada, a rede da visão fora) ficava 90 dias respondendo do cache, mesmo
 * depois de o dono resolver (I3). Linha de falha gravada pelo código antigo
 * (sem `falha`) não vale: lê de novo. PURO.
 */
export function guardadoVale(row: Pick<AnexoLido, "texto" | "detalhes">, assinatura: string, agora = new Date()): boolean {
  if (row.texto) return true;
  const falha = (row.detalhes as Detalhes | null)?.falha;
  return !!falha && falha.config === assinatura && new Date(falha.ate).getTime() > agora.getTime();
}

/**
 * Guarda a leitura. Protegido sem senha NÃO entra: depois de o dono cadastrar
 * a senha, a próxima pergunta precisa tentar de novo, não devolver "tem senha"
 * do cache. A falha entra com prazo curto e a assinatura da config (ver
 * `guardadoVale`); com `anexos.falhaGuardarMin` em zero, nem entra.
 */
async function guardar(userId: string, conta: ContaDoEmail, mensagemId: string, anexo: AnexoInfo, ex: Extraido, assinatura: string): Promise<void> {
  if (ex.protegido) return;
  let detalhes: Detalhes = detalhesDe(ex);
  if (!ex.lido) {
    const minutos = await settings.get("anexos.falhaGuardarMin");
    if (!minutos || minutos <= 0) return;
    detalhes = { ...detalhes, falha: { ate: new Date(Date.now() + minutos * 60_000).toISOString(), config: assinatura } };
  }
  const valores = {
    userId, conexaoId: conta.conexao.id, provedor: conta.conexao.provider, mensagemId, anexoId: anexo.id, nome: anexo.nome.slice(0, 300),
    sha256: ex.sha256, tamanho: ex.tamanho, tipo: ex.tipo.ext, familia: ex.tipo.familia, texto: ex.lido ? ex.texto : "", resumo: ex.resumo, detalhes: detalhes as Record<string, unknown>, lidoEm: new Date(),
  };
  await db.insert(anexoLido).values(valores).onConflictDoUpdate({ target: [anexoLido.userId, anexoLido.conexaoId, anexoLido.mensagemId, anexoLido.anexoId], set: { ...valores } });
}

function deLinha(row: AnexoLido) {
  return { texto: row.texto, resumo: row.resumo, tipo: row.tipo, familia: row.familia, detalhes: (row.detalhes ?? {}) as Detalhes };
}

function deExtraido(ex: Extraido) {
  return { texto: ex.lido ? ex.texto : "", resumo: ex.resumo, tipo: ex.tipo.ext, familia: ex.tipo.familia, detalhes: { ...detalhesDe(ex), ...(ex.protegido ? { protegido: true } : {}) } };
}

export interface PedidoDeAnexo {
  emailId: string;
  anexo: string;
  conta?: string | null;
  servico?: Servico | null;
  parte?: number;
}

/** O anexo que o pedido aponta, com o e-mail e a conta. Lança com mensagem útil. */
export async function localizarAnexo(userId: string, pedido: Pick<PedidoDeAnexo, "emailId" | "anexo" | "conta" | "servico">): Promise<{ email: EmailCompleto; conta: ContaDoEmail; anexo: AnexoInfo }> {
  const { email, conta } = await lerEmail(userId, pedido.emailId, { conta: pedido.conta, servico: pedido.servico });
  const anexo = escolherAnexo(email.anexos, pedido.anexo);
  if ("erro" in anexo) throw new Error(anexo.erro);
  return { email, conta, anexo };
}

/**
 * Lê com as senhas do remetente e marca como usada SÓ a que abriu (antes eram
 * todas as do domínio, M17). A senha só é tentada se o e-mail veio assinado
 * pelo domínio do From (M13, ver `senhasDoRemetente`).
 */
async function extrairComSenhas(userId: string, email: Pick<EmailCompleto, "de"> & { autenticacao?: string }, anexo: AnexoInfo, bytes: Buffer, opts: { progresso?: Progresso; sinal?: AbortSignal }): Promise<Extraido> {
  const { ids, senhas, naoAutenticado } = await senhasDoRemetente(userId, email.de, { autenticacao: email.autenticacao });
  // numa thread com teto: o anexo é de terceiro, e um parser preso não pode parar o api (B5)
  const ex = await extrairIsolado(bytes, { nome: anexo.nome, mimeDeclarado: anexo.tipo, userId, senhas, progresso: opts.progresso, sinal: opts.sinal });
  const usada = ex.senhaUsada !== undefined ? ids[ex.senhaUsada] : undefined;
  if (usada) await marcarSenhasUsadas(userId, [usada]).catch(() => undefined);
  if (ex.protegido && naoAutenticado) {
    const motivo = "O arquivo tem senha, mas este e-mail não veio assinado (DKIM) pelo domínio do remetente: a senha cadastrada para ele não foi tentada.";
    return { ...ex, resumo: motivo, protegido: { motivo } };
  }
  return ex;
}

/**
 * Leitura EM CURSO, por anexo, neste processo. Passando de `anexos.esperarSeg`,
 * a leitura continua (transcrição não se interrompe) e o trabalho `anexo.ler`
 * espera por ESTA mesma leitura em vez de baixar e ler tudo de novo: antes eram
 * duas transcrições pagas e as duas threads do pool ocupadas pelo mesmo arquivo
 * (I17). A fila roda no mesmo processo que a recebe (CLAUDE.md §9), então um
 * mapa do processo basta; depois de um reinício o mapa está vazio e o trabalho
 * lê do começo, como antes.
 */
interface EmCurso {
  promessa: Promise<Extraido>;
  /** quem acompanha agora (o trabalho que assumiu): o progresso dele é também onde o "parar" aparece */
  ouvinte?: Progresso;
}
const emCurso = new Map<string, EmCurso>();
const chaveDaLeitura = (userId: string, conexaoId: string, mensagemId: string, anexoId: string) => `${userId}:${conexaoId}:${mensagemId}:${anexoId}`;

function comecarLeitura(chave: string, ler: (progresso: Progresso) => Promise<Extraido>, ouvinte?: Progresso): EmCurso {
  const ja = emCurso.get(chave);
  if (ja) return ja;
  const entrada: EmCurso = { promessa: Promise.resolve() as unknown as Promise<Extraido>, ouvinte };
  const repassar: Progresso = async (feito, total, passo) => {
    await entrada.ouvinte?.(feito, total, passo);
  };
  entrada.promessa = ler(repassar).finally(() => {
    if (emCurso.get(chave) === entrada) emCurso.delete(chave);
  });
  emCurso.set(chave, entrada);
  return entrada;
}

/** Só para teste: quantas leituras estão em curso. */
export function _leiturasEmCurso(): number {
  return emCurso.size;
}

async function bytesConferidosDoAnexo(conta: ContaDoEmail, mensagemId: string, anexo: AnexoInfo, tetoMb: number): Promise<Buffer | string> {
  const bytes = await baixarAnexo(conta, mensagemId, anexo.id);
  if (bytes.length > tetoMb * 1024 * 1024) return `Anexo de ${tamanhoLegivel(bytes.length)}, maior que o teto de ${tetoMb} MB: não li.`;
  return bytes;
}

export async function lerAnexo(userId: string, pedido: PedidoDeAnexo): Promise<LeituraDoAnexo> {
  const cfg = await settings.getMany(["anexos.tamanhoMaxMb", "anexos.esperarSeg", "anexos.caracteresMax"]);
  const { email, conta, anexo } = await localizarAnexo(userId, pedido);
  const base = cabecalho(email, anexo);
  const parte = pedido.parte ?? 1;

  if (anexo.link) return { ...base, estado: "nao_lido", resumo: "Este anexo é um link para um documento compartilhado: não é baixado. Abra pelo link.", link: embrulharDadoExterno("email", anexo.link) };
  if (anexo.referencia) return { ...base, estado: "nao_lido", resumo: "Este anexo é um link do OneDrive (anexo de referência do Outlook): não é baixado, e o Outlook não entregou o endereço. Abra pelo próprio e-mail no Outlook." };
  if (anexo.tamanho > cfg["anexos.tamanhoMaxMb"] * 1024 * 1024) {
    return { ...base, estado: "nao_lido", resumo: `Anexo de ${tamanhoLegivel(anexo.tamanho)}, maior que o teto de ${cfg["anexos.tamanhoMaxMb"]} MB (Ajustes, Anexos): não baixei.` };
  }

  const assinatura = await assinaturaDaConfig();
  const guardado = await doCache(userId, conta.conexao.id, email.id, anexo.id);
  if (guardado && guardadoVale(guardado, assinatura)) return resposta(base, deLinha(guardado), parte, cfg["anexos.caracteresMax"], true);

  const chave = chaveDaLeitura(userId, conta.conexao.id, email.id, anexo.id);
  let atual = emCurso.get(chave);
  if (!atual) {
    const bytes = await bytesConferidosDoAnexo(conta, email.id, anexo, cfg["anexos.tamanhoMaxMb"]);
    if (typeof bytes === "string") return { ...base, estado: "nao_lido", resumo: bytes };

    // o MESMO arquivo já lido de outro e-mail (a fatura reenviada): reaproveita
    const { createHash } = await import("node:crypto");
    const igual = await porHash(userId, createHash("sha256").update(bytes).digest("hex"));
    if (igual) {
      await db.insert(anexoLido).values({ ...igual, id: undefined, conexaoId: conta.conexao.id, provedor: conta.conexao.provider, mensagemId: email.id, anexoId: anexo.id, nome: anexo.nome.slice(0, 300), lidoEm: new Date() }).onConflictDoNothing();
      return resposta(base, deLinha(igual), parte, cfg["anexos.caracteresMax"], true);
    }
    atual = comecarLeitura(chave, (progresso) => extrairComSenhas(userId, email, anexo, bytes, { progresso }));
  }

  const leitura = atual.promessa;
  const prazo = cfg["anexos.esperarSeg"] * 1000;
  let relogio: ReturnType<typeof setTimeout> | undefined;
  const venceu = new Promise<"venceu">((ok) => {
    relogio = setTimeout(() => ok("venceu"), prazo);
  });
  try {
    const r = await Promise.race([leitura, venceu]);
    if (r === "venceu") {
      // A leitura CONTINUA (não se joga fora o que já foi feito): quem a termina é ela mesma,
      // que guarda o resultado, e o trabalho da fila espera por ela em vez de ler de novo (I17)
      leitura.then((ex) => guardar(userId, conta, email.id, anexo, ex, assinatura)).catch(() => undefined);
      await enfileirarLeitura(userId, conta, email, anexo);
      return { ...base, estado: "em_andamento", resumo: "A leitura deste anexo vai demorar: continuei em segundo plano e aviso quando terminar." };
    }
    await guardar(userId, conta, email.id, anexo, r, assinatura).catch((e) => log.warn("anexos.guardar_falhou", { erro: e instanceof Error ? e.message : String(e) }));
    return resposta(base, deExtraido(r), parte, cfg["anexos.caracteresMax"], false);
  } finally {
    clearTimeout(relogio);
  }
}

export class AnexoNaoUsavelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnexoNaoUsavelError";
  }
}

/**
 * O texto de um anexo para AGIR com ele (cadastrar o boleto, lançar a nota):
 * do cache, ou baixado e lido agora. Usado na hora de propor, para o dono
 * aprovar os números que saíram do arquivo, e não os que o modelo digitou.
 *
 * Com os MESMOS tetos do `lerAnexo` (I9): o tamanho é conferido antes de
 * baixar, e a leitura espera até `anexos.esperarSeg`. Passando disso, a
 * leitura continua em segundo plano (pela fila, que avisa) e a proposta diz
 * para pedir de novo quando terminar: um PDF escaneado de 80 páginas não
 * segura o turno por minutos.
 */
export async function conteudoParaUsar(userId: string, conta: ContaDoEmail, email: EmailCompleto, anexo: AnexoInfo): Promise<{ texto: string; estruturado: unknown; sha256: string; resumo: string; protegido: boolean }> {
  if (anexo.link || anexo.referencia) throw new AnexoNaoUsavelError("Esse anexo é um link para um documento compartilhado, não um arquivo: não dá para usar daqui.");
  const cfg = await settings.getMany(["anexos.tamanhoMaxMb", "anexos.esperarSeg"]);
  if (anexo.tamanho > cfg["anexos.tamanhoMaxMb"] * 1024 * 1024) throw new AnexoNaoUsavelError(`O anexo tem ${tamanhoLegivel(anexo.tamanho)}, acima do teto de ${cfg["anexos.tamanhoMaxMb"]} MB (Ajustes, Anexos): não baixei.`);
  const assinatura = await assinaturaDaConfig();
  const guardado = await doCache(userId, conta.conexao.id, email.id, anexo.id);
  if (guardado && guardadoVale(guardado, assinatura)) return { texto: guardado.texto, estruturado: (guardado.detalhes as Detalhes).estruturado, sha256: guardado.sha256, resumo: guardado.resumo, protegido: false };

  const chave = chaveDaLeitura(userId, conta.conexao.id, email.id, anexo.id);
  let atual = emCurso.get(chave);
  if (!atual) {
    const bytes = await bytesConferidosDoAnexo(conta, email.id, anexo, cfg["anexos.tamanhoMaxMb"]);
    if (typeof bytes === "string") throw new AnexoNaoUsavelError(bytes);
    atual = comecarLeitura(chave, (progresso) => extrairComSenhas(userId, email, anexo, bytes, { progresso }));
  }
  let relogio: ReturnType<typeof setTimeout> | undefined;
  const venceu = new Promise<"venceu">((ok) => {
    relogio = setTimeout(() => ok("venceu"), cfg["anexos.esperarSeg"] * 1000);
  });
  try {
    const ex = await Promise.race([atual.promessa, venceu]);
    if (ex === "venceu") {
      atual.promessa.then((r) => guardar(userId, conta, email.id, anexo, r, assinatura)).catch(() => undefined);
      await enfileirarLeitura(userId, conta, email, anexo);
      throw new AnexoNaoUsavelError("A leitura deste anexo vai demorar: continuei em segundo plano e aviso quando terminar. Depois disso, peça de novo e a proposta sai com os números do arquivo.");
    }
    await guardar(userId, conta, email.id, anexo, ex, assinatura).catch(() => undefined);
    return { texto: ex.lido ? ex.texto : "", estruturado: ex.estruturado, sha256: ex.sha256, resumo: ex.resumo, protegido: Boolean(ex.protegido) };
  } finally {
    clearTimeout(relogio);
  }
}

async function enfileirarLeitura(userId: string, conta: ContaDoEmail, email: EmailCompleto, anexo: AnexoInfo): Promise<void> {
  const { enqueueJob } = await import("../jobs/queue");
  await enqueueJob(userId, {
    kind: "anexo.ler",
    // a autenticação vai junto: o trabalho decide, como aqui, se a senha do remetente pode ser tentada (M13)
    payload: { servico: conta.servico, conexaoId: conta.conexao.id, mensagemId: email.id, anexoId: anexo.id, nome: anexo.nome, assunto: email.assunto, de: email.de, tipo: anexo.tipo, autenticacao: (email.autenticacao ?? "").slice(0, 4000) },
    dedupKey: `anexo:${userId}:${conta.conexao.id}:${email.id}:${anexo.id}`,
  });
}

/**
 * O trabalho `anexo.ler`: lê sem prazo, com progresso, guarda e avisa. O
 * aviso vai pelo `notifyUser` (sino e, se ligado, a conversa "Eu" do
 * WhatsApp), com o resumo e a oferta de continuar.
 *
 * Se a leitura que passou do prazo ainda está em curso neste processo, o
 * trabalho a ACOMPANHA (o progresso dela vira o dele) em vez de ler de novo (I17).
 */
export async function lerAnexoEmSegundoPlano(
  userId: string,
  p: { servico: Servico; conexaoId: string; mensagemId: string; anexoId: string; nome: string; assunto: string; de: string; tipo: string; autenticacao?: string },
  progresso: Progresso,
): Promise<{ resumo: string; lido: boolean }> {
  const conta = await contaDaConexao(userId, p.servico, p.conexaoId);
  const anexo: AnexoInfo = { id: p.anexoId, nome: p.nome, tipo: p.tipo, tamanho: 0, embutido: false, link: null };
  const assinatura = await assinaturaDaConfig();
  const ja = await doCache(userId, conta.conexao.id, p.mensagemId, p.anexoId);
  if (ja && guardadoVale(ja, assinatura)) return { resumo: ja.resumo, lido: Boolean(ja.texto) };

  const chave = chaveDaLeitura(userId, conta.conexao.id, p.mensagemId, p.anexoId);
  let atual = emCurso.get(chave);
  if (atual) {
    atual.ouvinte = progresso;
    await progresso(0, null, "acompanhando a leitura que já estava em curso");
  } else {
    await progresso(0, null, "baixando o anexo");
    const bytes = await baixarAnexo(conta, p.mensagemId, p.anexoId);
    atual = comecarLeitura(chave, (repassar) => extrairComSenhas(userId, { de: p.de, autenticacao: p.autenticacao }, anexo, bytes, { progresso: repassar }), progresso);
  }
  const ex = await atual.promessa;
  await guardar(userId, conta, p.mensagemId, anexo, ex, assinatura);
  const { notifyUser } = await import("../routines/run");
  // o aviso vai ao histórico da conversa "Eu" EMBRULHADO (whatsapp/conversa.ts): nome e assunto são de quem mandou
  const corpo = ex.lido
    ? `"${p.nome}", do e-mail "${p.assunto}": ${ex.resumo} Quer o resumo? É só perguntar sobre ele.`
    : `"${p.nome}", do e-mail "${p.assunto}": ${ex.resumo}`;
  await notifyUser(userId, ex.lido ? "Terminei de ler o anexo" : "Não consegui ler o anexo", corpo).catch(() => undefined);
  return { resumo: ex.resumo, lido: ex.lido };
}

/** A retenção do que foi lido (`anexos.retencaoDias`; zero guarda para sempre). */
export async function purgarAnexosLidos(dias: number): Promise<number> {
  if (!dias || dias <= 0) return 0;
  const corte = new Date(Date.now() - dias * 24 * 3600 * 1000);
  const r = await db.delete(anexoLido).where(lt(anexoLido.lidoEm, corte)).returning({ id: anexoLido.id });
  return r.length;
}

