import { z } from "zod";
import { registerTools, type ToolDef } from "../registry";
import { settings } from "../../settings";
import { enviarAudio, enviarImagem, enviarTexto, jidDoDestino } from "../../whatsapp/enviar";
import * as store from "../../whatsapp/store";
import { sessaoDe } from "../../whatsapp/sessao";
import { lerMidia, tamanhoDaMidia } from "../../whatsapp/midia";
import { log } from "../../observability/logger";
import { normalizarJid } from "../../whatsapp/traduzir";
import { embrulhar, linhaDaMensagem } from "../../whatsapp/formatar";

export { embrulhar, linhaDaMensagem };
import { narrateSnapshot } from "../../cameras/narrate";
import { candidatosDaAgenda, contatosDaAgenda } from "../../contatos/agenda";
import { chaveDoTelefone, contatoPorTelefone, normalizarTelefone } from "../../contatos/casar";

/**
 * Domínio: WhatsApp (PRD-WHATSAPP W3 e W4).
 *
 * Ler é `leitura` e exige o número pessoal (a Cloud API não recebe nada).
 * Mandar é `efeito_externo`: o registro ENFILEIRA, nunca envia; o `run` só roda
 * depois que o dono aprova (tela, "manda" na conversa "Eu" ou por voz). Por
 * isso todo `run` de envio passa `aprovacaoHumana: true`: é verdade por
 * construção. A resposta automática (W7) NÃO usa estas tools: ela monta as
 * dela, presas ao chat de origem, em `whatsapp/automatico.ts`.
 *
 * Todo texto de mensagem volta ao modelo embrulhado como DADO (§5.2): quem
 * escreveu no WhatsApp não dá ordem à Órbita.
 */

/** Nome de terceiro dentro de um recado ao modelo: uma linha, curto, sem marcação (§5.2). */
const limparNome = (s: string | null | undefined) => (s ?? "?").replace(/[\r\n<>\[\]{}`*_]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40) || "?";

/**
 * "a Maria", "5511999998888" ou o JID: vira UM chat, ou um recado dizendo por
 * que não. Ambíguo nunca escolhe: responder para a Maria errada não se desfaz.
 *
 * Conversas do WhatsApp E agenda do Google, sempre as duas (só casamento
 * forte: nome, apelido, palavra inteira). O apelido que o DONO deu vence
 * sozinho. O mesmo número nas duas fontes é a mesma pessoa. Casamento fraco
 * ("Ana" dentro de "Juliana") nunca decide: vira pergunta.
 */
export async function resolverChat(userId: string, para: string): Promise<{ ok: true; jid: string; nome: string | null } | { ok: false; erro: string }> {
  const p = para.trim();
  if (p.includes("@")) {
    const c = await store.contatoPorJid(userId, normalizarJid(p));
    return { ok: true, jid: normalizarJid(p), nome: c?.apelido ?? c?.nome ?? null };
  }
  const contatos = await store.listarContatos(userId, 2000);
  const pelaChave = (numero: string) => contatos.find((c) => !c.grupo && chaveDoTelefone(c.jid.split("@")[0]) === chaveDoTelefone(numero));

  if (/^\+?[\d\s().-]+$/.test(p) && p.replace(/\D/g, "").length >= 10) {
    // "11 98888-7777" sem DDI virava o JID 11988887777, que é dos EUA
    const numero = normalizarTelefone(p);
    if (!numero) return { ok: false, erro: `"${p}" não parece um telefone completo. Peça com DDD (e DDI, se for de fora do Brasil).` };
    const conhecido = pelaChave(numero);
    return { ok: true, jid: conhecido?.jid ?? jidDoDestino(numero), nome: conhecido ? conhecido.apelido ?? conhecido.nome : null };
  }

  const forte = store.casarContatoForte(contatos, p);
  if (forte.porApelido && forte.achados.length === 1) return { ok: true, jid: forte.achados[0].jid, nome: forte.achados[0].apelido ?? forte.achados[0].nome };

  const candidatos = new Map<string, { jid: string; nome: string; numeros?: string[] }>();
  for (const c of forte.achados) candidatos.set(c.grupo ? c.jid : chaveDoTelefone(c.jid.split("@")[0]), { jid: c.jid, nome: c.apelido ?? c.nome ?? c.jid });
  // Fail-soft: sem a agenda, ficam só as conversas
  for (const a of await candidatosDaAgenda(userId, p).catch(() => [])) {
    if (a.numeros.length > 1) {
      candidatos.set(`agenda:${a.nome}`, { jid: "", nome: a.nome, numeros: a.numeros });
      continue;
    }
    const chave = chaveDoTelefone(a.numeros[0]);
    if (candidatos.has(chave)) continue; // a mesma pessoa, que já conversou: vale o JID da conversa
    // quem já conversou tem o JID CERTO, com ou sem o nono dígito: montar do
    // número da agenda abriria uma segunda conversa com a mesma pessoa
    const conhecido = pelaChave(a.numeros[0]);
    candidatos.set(chave, { jid: conhecido?.jid ?? jidDoDestino(a.numeros[0]), nome: a.nome + (a.soFixo ? " (telefone fixo)" : "") });
  }

  const lista = [...candidatos.values()];
  if (lista.length === 1 && !lista[0].numeros) return { ok: true, jid: lista[0].jid, nome: lista[0].nome };
  if (lista.length === 1) return { ok: false, erro: `${limparNome(lista[0].nome)} tem mais de um número na agenda: ${lista[0].numeros!.join(", ")}. Pergunte qual.` };
  if (lista.length > 1) {
    const opcoes = lista.slice(0, 8).map((c) => `${limparNome(c.nome)} (${c.numeros ? c.numeros.join(" ou ") : c.jid})`).join("; ");
    return { ok: false, erro: `Há mais de um contato para "${p}": ${opcoes}. Pergunte qual é e use o chat (jid) ou o número dele.` };
  }
  // Nada forte: o palpite vira PERGUNTA, nunca envio
  const parecidos = store.casarContato(contatos, p).slice(0, 5);
  if (parecidos.length) {
    return { ok: false, erro: `Não achei ninguém chamado exatamente "${p}". Parecidos: ${parecidos.map((c) => `${limparNome(c.apelido ?? c.nome)} (${c.jid})`).join("; ")}. Pergunte ao dono se é um desses.` };
  }
  return { ok: false, erro: `Não encontrei "${p}" nas conversas do WhatsApp nem na agenda de contatos. Peça o número ou o nome como aparece no WhatsApp.` };
}

// ── leitura ──

const Recentes = z.object({
  horas: z.number().int().min(1).max(720).optional().describe("Olhar as conversas com movimento nas últimas N horas (padrão 24)."),
  so_nao_lidas: z.boolean().optional().describe("Só conversas com mensagem que a Órbita ainda não leu."),
});

export const whatsapp_conversas_recentes: ToolDef<typeof Recentes> = {
  name: "whatsapp_conversas_recentes",
  domain: "whatsapp",
  description: "Lista as conversas do WhatsApp do dono com movimento recente, com quantas mensagens novas cada uma tem e a última mensagem. Use para 'tem algo no zap?', 'quem me mandou mensagem?'.",
  risk: "leitura",
  keywords: ["whatsapp", "zap", "mensagens", "conversas", "novas", "quem", "mandou"],
  requires: { whatsappPessoal: true },
  inputSchema: Recentes,
  run: async ({ horas, so_nao_lidas }, { userId }) => {
    const sessao = await sessaoDe(userId);
    const limite = await settings.get("whatsapp.leituraMax");
    const lista = await store.conversasRecentes(userId, limite, new Date(Date.now() - (horas ?? 24) * 3_600_000), sessao?.jid ?? null);
    const filtradas = so_nao_lidas ? lista.filter((c) => c.naoLidas > 0) : lista;
    if (!filtradas.length) return "Nenhuma conversa com movimento nesse período.";
    // o nome que o DONO deu na agenda vale mais que o que a pessoa escolheu no
    // WhatsApp ("Tia Cida" em vez de "Cida ✨"); o apelido dado aqui vale mais que os dois
    const agenda = await contatosDaAgenda(userId).catch(() => []);
    return embrulhar(
      filtradas.map((c) => {
        const daAgenda = c.contato.grupo ? null : contatoPorTelefone(agenda, c.contato.jid)?.nome;
        const nome = c.contato.apelido ?? daAgenda ?? c.contato.nome ?? c.contato.jid;
        const ultima = c.ultima ? linhaDaMensagem(c.ultima, nome) : "";
        return `${c.contato.grupo ? "Grupo " : ""}${nome} (chat ${c.contato.jid}) · ${c.naoLidas} nova(s) · última: ${ultima}`;
      }),
    );
  },
};

const Ler = z.object({
  contato: z.string().min(1).max(200).describe("Nome, apelido, número ou o chat (jid) da conversa."),
  quantidade: z.number().int().min(1).max(200).optional().describe("Quantas mensagens trazer (as mais recentes)."),
});

export const ler_whatsapp: ToolDef<typeof Ler> = {
  name: "ler_whatsapp",
  domain: "whatsapp",
  description: "Lê as mensagens recentes de UMA conversa do WhatsApp (pessoa ou grupo), com os áudios já transcritos. Use para 'o que a Maria mandou?', 'o que falaram no grupo da família?'.",
  risk: "leitura",
  keywords: ["whatsapp", "zap", "ler", "mensagem", "mandou", "disse", "audio", "grupo"],
  requires: { whatsappPessoal: true },
  inputSchema: Ler,
  run: async ({ contato, quantidade }, { userId }) => {
    const alvo = await resolverChat(userId, contato);
    if (!alvo.ok) return alvo.erro;
    const limite = quantidade ?? (await settings.get("whatsapp.leituraMax"));
    const msgs = await store.mensagensDoChat(userId, alvo.jid, limite);
    if (!msgs.length) return `Nenhuma mensagem guardada com ${alvo.nome ?? alvo.jid}.`;
    await store.marcarLidas(userId, alvo.jid);
    return `Conversa com ${alvo.nome ?? alvo.jid} (chat ${alvo.jid}):\n` + embrulhar(msgs.map((m) => linhaDaMensagem(m, alvo.nome)));
  },
};

const Buscar = z.object({
  termo: z.string().min(2).max(200).describe("O que procurar no texto e nos áudios transcritos."),
  contato: z.string().max(200).optional().describe("Restringir a uma conversa (nome, número ou jid)."),
});

export const buscar_whatsapp: ToolDef<typeof Buscar> = {
  name: "buscar_whatsapp",
  domain: "whatsapp",
  description: "Procura uma palavra ou assunto em todas as conversas do WhatsApp (texto e áudio transcrito). Use para 'quem falou do churrasco?', 'me mandaram o endereço?'.",
  risk: "leitura",
  keywords: ["whatsapp", "zap", "buscar", "procurar", "quem", "falou", "endereco"],
  requires: { whatsappPessoal: true },
  inputSchema: Buscar,
  run: async ({ termo, contato }, { userId }) => {
    let jid: string | null = null;
    if (contato) {
      const alvo = await resolverChat(userId, contato);
      if (!alvo.ok) return alvo.erro;
      jid = alvo.jid;
    }
    const achadas = await store.buscarMensagens(userId, termo, await settings.get("whatsapp.leituraMax"), jid);
    if (!achadas.length) return `Nada encontrado sobre "${termo}".`;
    const nomes = new Map((await store.listarContatos(userId, 2000)).map((c) => [c.jid, c.apelido ?? c.nome]));
    return embrulhar(achadas.map((m) => `(chat ${m.chatJid}) ` + linhaDaMensagem(m, nomes.get(m.chatJid) ?? null)));
  },
};

const VerImagem = z.object({
  mensagem_id: z.string().uuid().describe("O id da imagem, como aparece em [imagem id=...] na leitura."),
  pergunta: z.string().max(500).optional().describe("O que o dono quer saber da imagem."),
});

export const ver_imagem_whatsapp: ToolDef<typeof VerImagem> = {
  name: "ver_imagem_whatsapp",
  domain: "whatsapp",
  description: "Olha uma imagem recebida no WhatsApp e descreve o que tem nela (ou responde a uma pergunta sobre ela). Use depois de ler_whatsapp, com o id da imagem.",
  risk: "leitura",
  keywords: ["whatsapp", "foto", "imagem", "figura", "print", "ver"],
  requires: { whatsappPessoal: true },
  inputSchema: VerImagem,
  run: async ({ mensagem_id, pergunta }, { userId }) => {
    const m = await store.mensagemPorId(userId, mensagem_id);
    if (!m || m.tipo !== "imagem") return "Não encontrei essa imagem.";
    if (!m.midiaCaminho) return "A imagem chegou, mas o arquivo não pôde ser baixado.";
    if (!pergunta && m.descricaoImagem) return embrulhar([m.descricaoImagem]);
    const bytes = await lerMidia(m.midiaCaminho);
    const dataUrl = `data:${m.midiaMime ?? "image/jpeg"};base64,${Buffer.from(bytes).toString("base64")}`;
    const descricao = await narrateSnapshot(dataUrl, pergunta ?? "Descreva esta imagem com detalhes úteis, transcrevendo textos e valores visíveis.", { userId });
    // a descrição genérica fica guardada: a próxima pergunta não paga de novo
    if (!pergunta) await store.atualizarMensagemPorId(userId, m.id, { descricaoImagem: descricao });
    return embrulhar([descricao]);
  },
};

// ── arquivo que o DONO mandou vira ação (cupom, extrato, boleto, documento, reunião) ──

const UsarArquivo = z.object({
  mensagem_id: z.string().uuid().describe("O id do arquivo ou imagem que o DONO mandou na conversa com ele mesmo, como aparece em [imagem id=...] ou [documento id=...]."),
  como: z
    .enum(["cupom", "extrato", "boleto", "conhecimento", "reuniao"])
    .describe("cupom: foto/PDF de compra vira gasto lançado; extrato: PDF/CSV/OFX do banco vira lançamentos; boleto: lê valor e vencimento para cadastrar a conta; conhecimento: guarda o documento (ou a transcrição do áudio) para consultas futuras; reuniao: áudio de reunião vira transcrição com quem falou, resumo, compromissos e tarefas."),
});

type Como = z.infer<typeof UsarArquivo>["como"];

const MIME_DE_TEXTO = /^(text\/|application\/(json|xml|csv|x-ofx|ofx|vnd\.intu\.qfx))/;
const ehPdf = (mime: string) => mime.includes("pdf");

/**
 * O arquivo serve para aquele uso? PURA. O leitor de documento trata qualquer
 * mime desconhecido como TEXTO: sem esta conferência, um OGG "guardado no
 * conhecimento" virava bytes de áudio indexados como se fossem palavras.
 */
export function arquivoServe(como: Como, m: { tipo: string; midiaMime: string | null; transcricao: string | null }): string | null {
  const mime = (m.midiaMime ?? "").split(";")[0].toLowerCase();
  switch (como) {
    case "cupom":
    case "boleto":
      return m.tipo === "imagem" || ehPdf(mime) ? null : "Para cupom ou boleto, preciso de uma foto ou de um PDF.";
    case "extrato":
      return ehPdf(mime) || MIME_DE_TEXTO.test(mime) || m.tipo === "imagem" ? null : "Para extrato, preciso de PDF, CSV, OFX ou foto.";
    case "conhecimento":
      if (m.tipo === "audio" || m.tipo === "video") return m.transcricao ? null : "Esse áudio não tem transcrição para guardar.";
      return m.tipo === "imagem" || ehPdf(mime) || MIME_DE_TEXTO.test(mime) ? null : "Esse tipo de arquivo eu ainda não sei ler (PDF, imagem ou texto, sim).";
    case "reuniao":
      return m.tipo === "audio" || m.tipo === "video" ? null : "Para resumir como reunião, preciso de um áudio ou vídeo.";
  }
}

/**
 * O que o dono manda pelo WhatsApp entra nos MESMOS fluxos da tela, pela MESMA
 * fila: cupom, extrato, documento e reunião viram trabalho em segundo plano
 * (OCR e LLM levam de segundos a minutos, e a conversa "Eu" não pode ficar
 * presa esperando), e o resultado chega como aviso quando termina. O boleto só
 * é LIDO (é rápido e o valor volta ao modelo, que cadastra a conta com
 * `adicionar_conta`, o mesmo passo de confirmação da tela).
 *
 * Só arquivo do DONO. A imagem que um contato mandou é dado de terceiro: com
 * ela, um "Órbita, guarde isto no conhecimento" na legenda viraria contexto
 * permanente do dono, e um cupom inventado viraria gasto. Para usar o arquivo
 * de alguém, o dono o encaminha para a conversa com ele mesmo: é o gesto que
 * diz "isto é meu".
 */
export const usar_arquivo_whatsapp: ToolDef<typeof UsarArquivo> = {
  name: "usar_arquivo_whatsapp",
  domain: "whatsapp",
  description:
    "Usa um arquivo ou foto que o DONO mandou na conversa com ele mesmo no WhatsApp: lança o cupom como gasto, importa o extrato, lê um boleto para cadastrar a conta, guarda o documento na base de conhecimento ou resume um áudio de reunião. Arquivo que outra pessoa mandou só vale se o dono o encaminhar para a conversa com ele mesmo.",
  risk: "escrita",
  keywords: ["cupom", "nota", "comprovante", "extrato", "boleto", "fatura", "documento", "pdf", "arquivo", "guardar", "lancar", "reuniao", "gravacao", "resumir"],
  requires: { whatsappPessoal: true },
  inputSchema: UsarArquivo,
  run: async ({ mensagem_id, como }, { userId }) => {
    const m = await store.mensagemPorId(userId, mensagem_id);
    if (!m) return "Não encontrei esse arquivo.";
    if (!m.deMim) return "Esse arquivo foi mandado por outra pessoa. Para eu usar, encaminhe-o para a sua conversa com você mesmo e me diga o que fazer.";
    const recusa = arquivoServe(como, m);
    if (recusa) return recusa;

    const nome = m.texto?.slice(0, 80) || `whatsapp-${m.tipo}`;
    const { enqueueJob } = await import("../../jobs/queue");
    // áudio guardado no conhecimento é a TRANSCRIÇÃO, não o arquivo
    if (como === "conhecimento" && (m.tipo === "audio" || m.tipo === "video")) {
      await enqueueJob(userId, { kind: "rag.indexar_texto", input: m.transcricao!, payload: { title: nome, avisar: true }, dedupKey: `indexar-texto:${userId}:${m.id}` });
      return "Guardando a transcrição no conhecimento. Aviso quando terminar.";
    }

    if (!m.midiaCaminho) return "O arquivo chegou, mas não consegui baixá-lo do WhatsApp.";
    const cfg = await settings.getMany(["limits.uploadMaxMb", "limits.sttMaxMb"]);
    const teto = (como === "reuniao" ? cfg["limits.sttMaxMb"] : cfg["limits.uploadMaxMb"]) * 1024 * 1024;
    const tamanho = await tamanhoDaMidia(m.midiaCaminho);
    if (tamanho === null) return "O arquivo não está mais guardado (pode ter saído pela retenção).";
    if (tamanho > teto) return `O arquivo é grande demais para isso (limite de ${Math.round(teto / 1024 / 1024)} MB).`;

    try {
      const mime = (m.midiaMime ?? "application/octet-stream").split(";")[0];
      const dataUrl = `data:${mime};base64,${Buffer.from(await lerMidia(m.midiaCaminho)).toString("base64")}`;
      // a mesma chave da tela (sha curto): a mesma gravação pela tela e pelo WhatsApp é UM trabalho
      const sha = (m.midiaSha256 ?? m.id).slice(0, 24);
      if (como === "reuniao") {
        await enqueueJob(userId, { kind: "reuniao.transcrever", input: dataUrl, payload: { title: m.texto?.slice(0, 120) || "Reunião pelo WhatsApp" }, dedupKey: `transcrever:${userId}:${sha}` });
        return "Comecei a transcrever e resumir a reunião. O resumo, os compromissos e as tarefas chegam aqui quando terminar.";
      }
      if (como === "cupom") {
        await enqueueJob(userId, { kind: "financas.cupom", input: dataUrl, payload: { avisar: true }, dedupKey: `cupom:${userId}:${sha}` });
        return "Lendo o comprovante. Aviso quando lançar.";
      }
      if (como === "extrato") {
        await enqueueJob(userId, { kind: "financas.extrato", input: dataUrl, payload: { nome, avisar: true }, dedupKey: `extrato:${userId}:${sha}` });
        return "Importando o extrato. Aviso quando terminar.";
      }
      if (como === "conhecimento") {
        await enqueueJob(userId, { kind: "rag.indexar_arquivo", input: dataUrl, payload: { nome, avisar: true }, dedupKey: `indexar:${userId}:${sha}` });
        return "Guardando no conhecimento. Aviso quando terminar.";
      }
      // boleto: leitura rápida, o resultado volta ao modelo
      const { extractFileText } = await import("../../rag/files");
      const { lerBoleto } = await import("../../finance/entradas");
      const { carregar, hojeDoServidor } = await import("../../finance/store");
      const { limiaresDaConfig } = await import("../../finance/config");
      const texto = (await extractFileText(dataUrl, nome)).text;
      const hoje = hojeDoServidor();
      const b = lerBoleto(await carregar(userId, hoje, (await limiaresDaConfig()).mesesSemeados), { textoDoPdf: texto }, hoje);
      return `Boleto lido: ${b.beneficiario ?? "beneficiário não identificado"}, R$ ${(b.valor / 100).toFixed(2).replace(".", ",")}, vencimento ${b.vencimento ?? "não identificado"}. Para cadastrar, use adicionar_conta com estes dados.`;
    } catch (e) {
      log.warn("whatsapp.usar_arquivo_falhou", { como, erro: e instanceof Error ? e.message : String(e) });
      // o erro não vai cru para a conversa: pode trazer caminho de disco ou SQL
      if (como === "boleto") return "Não consegui ler o código desse boleto. Mande o PDF do boleto ou digite a linha digitável aqui.";
      return "Não consegui usar esse arquivo agora. Tente de novo em instantes.";
    }
  },
};

// ── envio (sempre pelo gate) ──

const Para = z.string().min(1).max(200).describe("Para quem: o chat (jid) devolvido pela leitura, de preferência; ou o número com DDI; ou o nome como aparece no WhatsApp.");

/** Quem recebe, legível: "Maria Souza (5511999998888)". PURA. */
export function destinoLegivel(para: string, nome?: string | null): string {
  const numero = para.includes("@") ? para.split("@")[0] : para;
  const grupo = para.endsWith("@g.us");
  if (nome) return grupo ? `grupo ${nome}` : `${nome} (${numero})`;
  return grupo ? `grupo ${numero}` : numero;
}

/** Resumo da proposta com o destino RESOLVIDO e o TEXTO INTEIRO: o dono aprova exatamente o que vai sair. */
const resumoDe = (acao: string, i: { para: string; para_nome?: string | null }, texto: string) => `${acao} para ${destinoLegivel(i.para, i.para_nome)}: "${texto.slice(0, 1000)}"`;

/**
 * Fixa o destino na hora de PROPOR: "a Maria" vira o JID dela, e é para esse
 * JID que a mensagem vai depois da aprovação, sem resolver de novo.
 */
async function fixarDestino<T extends { para: string; para_nome?: string | null }>(input: T, ctx: { userId: string }): Promise<T> {
  const alvo = await resolverChat(ctx.userId, input.para);
  // o nome do resumo vem SÓ do código (conversa ou agenda), nunca do modelo:
  // "para: <número do golpista>, para_nome: Mãe" seria aprovado pela confiança no nome
  return alvo.ok ? { ...input, para: alvo.jid, para_nome: alvo.nome } : { ...input, para_nome: null };
}

async function destino(userId: string, para: string): Promise<string> {
  const alvo = await resolverChat(userId, para);
  if (!alvo.ok) throw new Error(alvo.erro);
  return alvo.jid;
}

/** Recusa ANTES de enfileirar: proposta ambígua nem chega à fila de aprovação. */
const conferirDestino = async (input: { para: string }, ctx: { userId: string }) => {
  const alvo = await resolverChat(ctx.userId, input.para);
  return alvo.ok ? null : alvo.erro;
};

const EnviarTexto = z.object({ para: z.string().min(1).max(200), texto: z.string().min(1).max(4000), para_nome: z.string().max(200).nullish() });

export const enviar_whatsapp: ToolDef<typeof EnviarTexto> = {
  name: "enviar_whatsapp",
  domain: "whatsapp",
  description: "Propõe enviar uma mensagem de texto de WhatsApp para um número (com DDI, ex: 5511999998888) ou contato. Não envia direto: a proposta espera a aprovação do dono.",
  risk: "efeito_externo",
  keywords: ["whatsapp", "zap", "mensagem", "mandar", "avisar"],
  requires: { whatsapp: true },
  inputSchema: EnviarTexto,
  summarize: (i) => resumoDe("Enviar WhatsApp", i, i.texto),
  authorize: conferirDestino,
  preparar: fixarDestino,
  run: async ({ para, texto }, { userId }) => {
    const r = await enviarTexto(userId, await destino(userId, para), texto, { aprovacaoHumana: true });
    return `WhatsApp enviado (id ${r.id}).`;
  },
};

const Responder = z.object({
  para: Para,
  para_nome: z.string().max(200).nullish().describe("Preenchido pela Órbita; não informe."),
  texto: z.string().min(1).max(4000).describe("O texto exato da resposta."),
  citar_mensagem_id: z.string().max(200).optional().describe("Id no WhatsApp da mensagem a citar (opcional)."),
});

export const responder_whatsapp: ToolDef<typeof Responder> = {
  name: "responder_whatsapp",
  domain: "whatsapp",
  description: "Propõe responder em TEXTO numa conversa do WhatsApp do dono. Não envia direto: o dono aprova (tela, dizendo 'manda', ou por voz). Mostre a ele o texto exato.",
  risk: "efeito_externo",
  keywords: ["whatsapp", "zap", "responder", "resposta", "mandar", "dizer"],
  requires: { whatsappPessoal: true },
  inputSchema: Responder,
  summarize: (i) => resumoDe("Responder no WhatsApp", i, i.texto),
  authorize: conferirDestino,
  preparar: fixarDestino,
  run: async ({ para, texto, citar_mensagem_id }, { userId }) => {
    const r = await enviarTexto(userId, await destino(userId, para), texto, { aprovacaoHumana: true, citando: citar_mensagem_id ?? null });
    return `Resposta enviada (id ${r.id}).`;
  },
};

const Audio = z.object({
  para: Para,
  para_nome: z.string().max(200).nullish().describe("Preenchido pela Órbita; não informe."),
  texto: z.string().min(1).max(2000).describe("O que a Órbita vai FALAR na nota de voz."),
});

export const enviar_audio_whatsapp: ToolDef<typeof Audio> = {
  name: "enviar_audio_whatsapp",
  domain: "whatsapp",
  description: "Propõe mandar uma NOTA DE VOZ no WhatsApp, com a voz da Órbita falando o texto. Use quando o dono pedir resposta em áudio. Não envia direto: o dono aprova.",
  risk: "efeito_externo",
  keywords: ["whatsapp", "zap", "audio", "voz", "falar", "nota"],
  requires: { whatsappPessoal: true },
  inputSchema: Audio,
  summarize: (i) => resumoDe("Mandar áudio no WhatsApp", i, i.texto),
  authorize: conferirDestino,
  preparar: fixarDestino,
  run: async ({ para, texto }, { userId }) => {
    const r = await enviarAudio(userId, await destino(userId, para), texto, { aprovacaoHumana: true });
    return `Áudio enviado (id ${r.id}).`;
  },
};

const Imagem = z.object({
  para: Para,
  para_nome: z.string().max(200).nullish().describe("Preenchido pela Órbita; não informe."),
  mensagem_id: z.string().uuid().describe("O id da imagem guardada ([imagem id=...]), inclusive uma que o dono mandou na conversa com ele mesmo."),
  legenda: z.string().max(1000).optional(),
});

export const enviar_imagem_whatsapp: ToolDef<typeof Imagem> = {
  name: "enviar_imagem_whatsapp",
  domain: "whatsapp",
  description: "Propõe mandar uma IMAGEM no WhatsApp: uma que chegou numa conversa ou que o dono mandou na conversa com ele mesmo ('manda essa foto pra Maria'). Não envia direto: o dono aprova.",
  risk: "efeito_externo",
  keywords: ["whatsapp", "zap", "foto", "imagem", "mandar", "encaminhar"],
  requires: { whatsappPessoal: true },
  inputSchema: Imagem,
  summarize: (i) => `Mandar imagem no WhatsApp para ${destinoLegivel(i.para, i.para_nome)}` + (i.legenda ? `: "${i.legenda.slice(0, 300)}"` : ""),
  authorize: conferirDestino,
  preparar: fixarDestino,
  run: async ({ para, mensagem_id, legenda }, { userId }) => {
    const r = await enviarImagem(userId, await destino(userId, para), mensagem_id, legenda ?? null, { aprovacaoHumana: true });
    return `Imagem enviada (id ${r.id}).`;
  },
};

registerTools([whatsapp_conversas_recentes, ler_whatsapp, buscar_whatsapp, ver_imagem_whatsapp, usar_arquivo_whatsapp, enviar_whatsapp, responder_whatsapp, enviar_audio_whatsapp, enviar_imagem_whatsapp]);
