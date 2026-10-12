import { createHash } from "node:crypto";
import { z } from "zod";
import { settings } from "../../settings";
import { log } from "../../observability/logger";
import { getTool, registerTools, type ToolContext, type ToolDef } from "../registry";
import { embrulharDadoExterno } from "../../texto/dado-externo";
import { partesDoTexto, tamanhoLegivel } from "../../arquivos/texto";
import { baixarAnexo, contaDaConexao, lerEmail, type Servico } from "../../anexos/email";
import { boletoNoTexto, conteudoParaUsar, lerAnexo, localizarAnexo } from "../../anexos/ler";
import type { NotaFiscalLida } from "../../arquivos/tipos";
import { OUTLOOK_ANEXO_MAX_BYTES } from "../../connectors/microsoft";

/**
 * Domínio: anexos e o e-mail inteiro (PRD de anexos, C1, C2 e C4).
 *
 * Valem para Gmail e Outlook juntos (`requires.connector` em lista): o modelo
 * tem o id que veio de `ler_emails` ou `outlook_ler_emails`, e a conta é achada
 * procurando o id em todas (`anexos/email.ts`).
 *
 * Ler é `leitura`. Fazer algo com o anexo é `efeito_externo`, pela fila de
 * aprovação: o e-mail é de TERCEIRO, e um "guarde isto" ou um boleto inventado
 * não pode virar contexto permanente nem conta a pagar sozinho (a mesma lição
 * do `usar_arquivo_whatsapp`). O que o dono aprova é o que saiu do arquivo:
 * o `preparar` lê o boleto e fixa valor, vencimento e linha digitável antes de
 * enfileirar, e o resumo da fila mostra esses números.
 */

const CONTA = z.string().max(120).optional().describe("qual conta (ex.: 'trabalho'); vazio procura em todas");
const SERVICO = z.enum(["gmail", "outlook"]).optional().describe("de onde veio o id, se souber; vazio descobre sozinho");
const PARTE = z.number().int().min(1).max(500).optional().describe("texto longo vem em partes: peça a seguinte quando a resposta disser que há mais");
const FIXO = "Preenchido pela Órbita; não informe.";

const LerEmail = z.object({
  id: z.string().min(1).max(400).describe("o id do e-mail, como veio de ler_emails ou outlook_ler_emails"),
  conta: CONTA,
  servico: SERVICO,
  parte: PARTE,
});

export const ler_email: ToolDef<typeof LerEmail> = {
  name: "ler_email",
  domain: "anexos",
  description:
    "Abre UM e-mail inteiro (Gmail ou Outlook): remetente, para, cc, data, assunto, o corpo completo e a lista de anexos (nome, tipo, tamanho e id). Use quando o resumo de ler_emails não basta ou para ver o que veio anexado. Para abrir um anexo, use ler_anexo.",
  risk: "leitura",
  keywords: ["email", "e-mail", "ler", "abrir", "inteiro", "corpo", "mensagem", "anexo", "anexado", "anexos", "outlook", "gmail"],
  requires: { connector: ["google", "microsoft"] },
  inputSchema: LerEmail,
  run: async ({ id, conta, servico, parte }, { userId }) => {
    const max = await settings.get("anexos.caracteresMax");
    const { email } = await lerEmail(userId, id, { conta, servico: servico as Servico | undefined });
    const texto = [
      `De: ${email.de}`,
      email.para.length ? `Para: ${email.para.join(", ")}` : null,
      email.cc.length ? `Cc: ${email.cc.join(", ")}` : null,
      `Data: ${email.data}`,
      `Assunto: ${email.assunto}`,
      "",
      email.corpo || "(corpo vazio)",
    ].filter((l): l is string => l !== null).join("\n");
    const pedacos = partesDoTexto(texto, max);
    const n = Math.min(parte ?? 1, pedacos.length);
    return {
      email: { id: email.id, servico: email.servico, conta: email.conta, data: email.data },
      // corpo, assunto e remetente são de quem escreveu: DADO, nunca instrução (§5.2)
      conteudo: embrulharDadoExterno("email", pedacos[n - 1]!),
      parte: n,
      partes: pedacos.length,
      ...(pedacos.length > n ? { dica: `Há mais texto: peça parte=${n + 1} (de ${pedacos.length}).` } : {}),
      // o nome do arquivo e os links são escolha de quem mandou: também DADO (I2 da auditoria)
      anexos: email.anexos.map((a, i) => ({ posicao: i + 1, id: a.id, nome: embrulharDadoExterno("anexo", a.nome), tipo: a.tipo, tamanho: tamanhoLegivel(a.tamanho), embutido_no_corpo: a.embutido, ...(a.link ? { link: embrulharDadoExterno("email", a.link) } : {}) })),
      ...(email.links.length ? { documentos_compartilhados: embrulharDadoExterno("email", email.links.join("\n")), sobre_os_links: "Documentos citados no e-mail: listados, não baixados. Abrir é pelo navegador." } : {}),
      ...(email.abrir ? { abrir: email.abrir } : {}),
    };
  },
};

const LerAnexo = z.object({
  email_id: z.string().min(1).max(400).describe("o id do e-mail, como veio de ler_emails, outlook_ler_emails ou ler_email"),
  anexo: z.string().min(1).max(300).describe("o id do anexo (de ler_email), a posição ('1', '2') ou um pedaço do nome ('contrato')"),
  conta: CONTA,
  servico: SERVICO,
  parte: PARTE,
});

export const ler_anexo: ToolDef<typeof LerAnexo> = {
  name: "ler_anexo",
  domain: "anexos",
  description:
    "Abre um ANEXO de e-mail e devolve o que está dentro: texto de PDF (com OCR), Word, planilha (cada aba em tabela), apresentação, ZIP, e-mail anexado, áudio e vídeo (transcritos), convite, contato, nota fiscal. Detecta boleto e devolve valor, vencimento e linha digitável. Arquivo demorado continua em segundo plano e a Órbita avisa. PDF com senha usa a senha cadastrada pelo dono em Ajustes (nunca peça senha na conversa).",
  risk: "leitura",
  keywords: ["anexo", "anexado", "arquivo", "pdf", "planilha", "excel", "word", "documento", "contrato", "boleto", "fatura", "extrato", "zip", "abrir", "ler", "o que diz"],
  requires: { connector: ["google", "microsoft"] },
  inputSchema: LerAnexo,
  run: async ({ email_id, anexo, conta, servico, parte }, { userId }) =>
    lerAnexo(userId, { emailId: email_id, anexo, conta, servico: servico as Servico | undefined, parte }),
};

const UsarAnexo = z.object({
  email_id: z.string().min(1).max(400).describe("o id do e-mail do anexo"),
  anexo: z.string().min(1).max(300).describe("o id do anexo (de ler_email), a posição ou um pedaço do nome"),
  como: z
    .enum(["boleto", "cupom", "extrato", "conhecimento", "encaminhar"])
    .describe("boleto: cadastra a conta a pagar com valor, vencimento e linha digitável lidos do arquivo; cupom: lança a compra (nota fiscal XML, cupom ou comprovante em PDF/foto); extrato: importa os lançamentos do extrato do banco; conhecimento: guarda o documento na base de conhecimento para consultas futuras; encaminhar: manda o arquivo para alguém por WhatsApp ou e-mail (informe `por` e `para`)"),
  por: z.enum(["whatsapp", "email"]).optional().describe("só com encaminhar: por onde o arquivo vai"),
  para: z.string().max(320).optional().describe("só com encaminhar: para quem (nome da agenda, número com DDI ou e-mail)"),
  mensagem: z.string().max(2000).optional().describe("só com encaminhar: o texto que acompanha o arquivo"),
  conta: CONTA,
  servico: SERVICO,
  para_nome: z.string().max(200).nullish().describe(FIXO),
  assunto_email: z.string().max(300).optional().describe(FIXO),
  conexao_id: z.string().max(80).optional().describe(FIXO),
  anexo_id: z.string().max(300).optional().describe(FIXO),
  nome_arquivo: z.string().max(300).optional().describe(FIXO),
  remetente: z.string().max(300).optional().describe(FIXO),
  autenticacao_email: z.string().max(4000).optional().describe(FIXO),
  sha256: z.string().max(80).optional().describe(FIXO),
  valor: z.number().positive().max(10_000_000_000).optional().describe(FIXO),
  vencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().describe(FIXO),
  linha: z.string().max(60).optional().describe(FIXO),
  beneficiario: z.string().max(200).nullish().describe(FIXO),
  data: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish().describe(FIXO),
});
type EntradaDeUsar = z.infer<typeof UsarAnexo>;

/**
 * Os campos "Preenchido pela Órbita": tirados do próprio schema (a descrição
 * FIXO), para um campo novo desse tipo entrar sozinho na limpeza abaixo.
 */
export const CAMPOS_FIXOS_DO_USO = Object.entries(UsarAnexo.shape)
  .filter(([, campo]) => (campo as { description?: string }).description === FIXO)
  .map(([nome]) => nome) as (keyof EntradaDeUsar)[];

/**
 * A entrada do modelo SEM nenhum campo fixo. O `preparar` parte daqui e só
 * preenche o que leu do arquivo: antes ele espalhava a entrada inteira, e um
 * cupom sem nota fiscal ia para a fila com o valor, o beneficiário e a data
 * que o modelo digitou (B7 da revisão), aprovados como se viessem do arquivo.
 */
function semCamposFixos(i: EntradaDeUsar): EntradaDeUsar {
  const limpo = { ...i } as Record<string, unknown>;
  for (const k of CAMPOS_FIXOS_DO_USO) delete limpo[k];
  return limpo as EntradaDeUsar;
}

const brl = (v?: number) => (v === undefined ? "valor não lido" : `R$ ${v.toFixed(2).replace(".", ",")}`);
const linhaLegivel = (l?: string) => (l ? l.replace(/(\d{5})(\d{5})(\d{5})(\d{6})(\d{5})(\d{6})(\d)(\d{14})/, "$1.$2 $3.$4 $5.$6 $7 $8") : "");

/**
 * Fixa o que o dono vai aprovar, a partir do ARQUIVO. Sem isto, o valor e o
 * vencimento seriam o que o modelo leu e redigitou, e a aprovação mostraria um
 * número que ninguém conferiu contra o boleto.
 */
async function prepararUso(i: EntradaDeUsar, ctx: ToolContext): Promise<EntradaDeUsar> {
  const { email, conta, anexo } = await localizarAnexo(ctx.userId, { emailId: i.email_id, anexo: i.anexo, conta: i.conta, servico: i.servico as Servico | undefined });
  if (anexo.link || anexo.referencia) throw new Error("Esse anexo é um link para um documento compartilhado, não um arquivo: não dá para usar daqui.");
  // o From e a autenticação vão FIXADOS: é por eles que o trabalho escolhe a senha do remetente (I16, M13)
  const fixo: EntradaDeUsar = { ...semCamposFixos(i), email_id: email.id, servico: conta.servico, conexao_id: conta.conexao.id, anexo_id: anexo.id, nome_arquivo: anexo.nome.slice(0, 300), remetente: email.de.slice(0, 300), autenticacao_email: (email.autenticacao ?? "").slice(0, 4000) };
  if (i.como === "encaminhar" || i.como === "extrato" || i.como === "conhecimento") {
    // o teto vem ANTES de baixar: um anexo de 300 MB era baixado inteiro só para calcular o hash (I9)
    const teto = await settings.get("anexos.tamanhoMaxMb");
    if (anexo.tamanho > teto * 1024 * 1024) throw new Error(`O anexo tem ${tamanhoLegivel(anexo.tamanho)}, acima do teto de ${teto} MB (Ajustes, Anexos).`);
    const bytes = await baixarAnexo(conta, email.id, anexo.id);
    if (bytes.length > teto * 1024 * 1024) throw new Error(`O anexo tem ${tamanhoLegivel(bytes.length)}, acima do teto de ${teto} MB (Ajustes, Anexos).`);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (i.como === "encaminhar") return { ...(await fixarDestinoDoArquivo(fixo, ctx, bytes.length)), sha256, assunto_email: email.assunto.slice(0, 300) };
    return { ...fixo, sha256 };
  }
  const lido = await conteudoParaUsar(ctx.userId, conta, email, anexo);
  if (lido.protegido) throw new Error(`${lido.resumo} (a senha se cadastra em Ajustes, Anexos; nunca pela conversa)`);
  if (i.como === "boleto") {
    const b = boletoNoTexto(lido.texto);
    if (!b) throw new Error(`Não achei a linha digitável de um boleto em "${anexo.nome}". ${lido.resumo}`);
    return { ...fixo, sha256: lido.sha256, valor: b.valor, vencimento: b.vencimento, linha: b.linha, beneficiario: b.beneficiario };
  }
  // cupom: a nota fiscal em XML já traz valor, emitente e data exatos
  const nf = (lido.estruturado as { tipo?: string; nota?: NotaFiscalLida } | undefined)?.tipo === "nota_fiscal" ? (lido.estruturado as { nota: NotaFiscalLida }).nota : null;
  if (nf && nf.valorTotal) return { ...fixo, sha256: lido.sha256, valor: nf.valorTotal, beneficiario: nf.nomeFantasia || nf.emitente, data: nf.data };
  return { ...fixo, sha256: lido.sha256 };
}

/**
 * Encaminhar: o destino é resolvido AGORA, pelo código (conversa do WhatsApp ou
 * agenda), e é ele que o dono aprova. O nome do resumo nunca vem do modelo:
 * um e-mail com injeção faria propor "para: número do golpista, para_nome: Mãe"
 * (a mesma regra de `fixarDestino` e `fixarEmail`).
 */
async function fixarDestinoDoArquivo(i: EntradaDeUsar, ctx: ToolContext, tamanho: number): Promise<EntradaDeUsar> {
  if (!i.por || !i.para?.trim()) throw new Error("Para encaminhar, diga por onde (whatsapp ou email) e para quem.");
  if (i.por === "whatsapp") {
    const { provedorAtivo } = await import("../../whatsapp/enviar");
    if ((await provedorAtivo(ctx.userId)) !== "pessoal") throw new Error("Mandar arquivo pelo WhatsApp precisa do WhatsApp pessoal conectado.");
    const { resolverChat } = await import("./whatsapp");
    const alvo = await resolverChat(ctx.userId, i.para);
    if (!alvo.ok) throw new Error(alvo.erro);
    return { ...i, para: alvo.jid, para_nome: alvo.nome };
  }
  const { resolverEmail } = await import("../../contatos/agenda");
  const alvo = await resolverEmail(ctx.userId, i.para);
  if (!alvo.ok) throw new Error(alvo.erro);
  if (i.servico === "outlook" && tamanho > OUTLOOK_ANEXO_MAX_BYTES) throw new Error(`O anexo tem ${tamanhoLegivel(tamanho)}; pelo Outlook a Órbita encaminha até ${tamanhoLegivel(OUTLOOK_ANEXO_MAX_BYTES)}.`);
  return { ...i, para: alvo.email, para_nome: alvo.nome };
}

function destinoDoArquivo(i: EntradaDeUsar): string {
  if (i.por === "whatsapp") return `${i.para_nome ? `${i.para_nome} ` : ""}(${(i.para ?? "?").split("@")[0]}) pelo WhatsApp`;
  return `${i.para_nome ? `${i.para_nome} <${i.para}>` : i.para ?? "?"} por e-mail`;
}

function resumoDoUso(i: EntradaDeUsar): string {
  const origem = `"${i.nome_arquivo ?? i.anexo}"${i.remetente ? `, do e-mail de ${i.remetente}` : ""}`;
  switch (i.como) {
    case "boleto":
      return `Cadastrar a conta a pagar ${i.beneficiario ?? i.nome_arquivo ?? "do boleto"}: ${brl(i.valor)}, vencimento ${i.vencimento ?? "não lido"}, linha digitável ${linhaLegivel(i.linha) || "?"} (boleto ${origem})`;
    case "cupom":
      return i.valor ? `Lançar a compra em ${i.beneficiario ?? "?"}: ${brl(i.valor)}${i.data ? ` em ${i.data}` : ""} (nota fiscal ${origem})` : `Ler o comprovante ${origem} e lançar como gasto`;
    case "extrato":
      return `Importar os lançamentos do extrato ${origem}`;
    case "conhecimento":
      return `Guardar ${origem} na base de conhecimento`;
    case "encaminhar":
      return `Encaminhar ${origem} para ${destinoDoArquivo(i)}${i.mensagem ? `, com a mensagem: "${i.mensagem.slice(0, 500)}"` : ""}`;
  }
}

async function bytesConferidos(userId: string, i: EntradaDeUsar): Promise<{ bytes: Buffer; mime: string; dataUrl: string } | string> {
  if (!i.servico || !i.conexao_id || !i.anexo_id || !i.sha256) return "A proposta chegou sem o anexo fixado. Peça de novo.";
  const conta = await contaDaConexao(userId, i.servico as Servico, i.conexao_id);
  const bytes = await baixarAnexo(conta, i.email_id, i.anexo_id);
  // o dono aprovou ESTE arquivo: se o anexo mudou entre propor e aprovar, não é o mesmo pedido
  if (createHash("sha256").update(bytes).digest("hex") !== i.sha256) return "O anexo mudou desde a proposta. Peça de novo para eu ler a versão atual.";
  const teto = (await settings.get("anexos.tamanhoMaxMb")) * 1024 * 1024;
  if (bytes.length > teto) return `O anexo passa do teto de ${tamanhoLegivel(teto)} (Ajustes, Anexos).`;
  const { detectarTipo } = await import("../../arquivos/detectar");
  const tipo = await detectarTipo(bytes, i.nome_arquivo);
  return { bytes, mime: tipo.mime, dataUrl: `data:${tipo.mime};base64,${bytes.toString("base64")}` };
}

/** Executa o encaminhamento APROVADO, pelo destino fixado na proposta. */
async function encaminhar(userId: string, i: EntradaDeUsar, arquivo: { bytes: Buffer; mime: string; nome: string }): Promise<string> {
  if (!i.para) return "A proposta chegou sem o destino. Peça de novo.";
  const texto = i.mensagem?.trim() || "Segue o arquivo.";
  if (i.por === "whatsapp") {
    const { enviarDocumento } = await import("../../whatsapp/enviar");
    const r = await enviarDocumento(userId, i.para, arquivo, i.mensagem?.trim() || null, { aprovacaoHumana: true });
    return `Arquivo enviado pelo WhatsApp (id ${r.id}).`;
  }
  const conta = await contaDaConexao(userId, i.servico as Servico, i.conexao_id!);
  const assunto = `Fwd: ${i.assunto_email ?? arquivo.nome}`;
  // sai pela MESMA conta onde o e-mail chegou: é dela que o dono está encaminhando
  if (conta.servico === "gmail") {
    const { enviarEmailComAnexo } = await import("../../connectors/google");
    await enviarEmailComAnexo(conta.token, i.para, assunto, texto, arquivo);
  } else {
    const { enviarEmailComAnexoOutlook } = await import("../../connectors/microsoft");
    await enviarEmailComAnexoOutlook(conta.token, i.para, assunto, texto, arquivo);
  }
  return `Arquivo encaminhado por e-mail pela conta ${conta.rotulo}.`;
}

async function rodarFinancas(nome: string, entrada: Record<string, unknown>, ctx: ToolContext): Promise<unknown> {
  const tool = getTool(nome);
  if (!tool) throw new Error(`A ferramenta ${nome} não está registrada.`);
  const parsed = tool.inputSchema.safeParse(entrada);
  if (!parsed.success) throw new Error(`Dados do anexo não servem para ${nome}.`);
  return tool.run(parsed.data, ctx);
}

export const usar_anexo: ToolDef<typeof UsarAnexo> = {
  name: "usar_anexo",
  domain: "anexos",
  description:
    "Faz algo com um anexo de e-mail, SEMPRE com a aprovação do dono: cadastra o boleto como conta a pagar (valor, vencimento e linha digitável lidos do arquivo), lança a compra de uma nota fiscal ou comprovante, importa um extrato, guarda o documento no conhecimento, ou encaminha o arquivo para alguém por WhatsApp ou e-mail. Não executa direto: cria a proposta e o dono aprova. Informe que a proposta foi criada.",
  risk: "efeito_externo",
  keywords: ["anexo", "boleto", "lançar", "lança", "cadastrar", "conta", "pagar", "cupom", "nota", "fiscal", "extrato", "importar", "guardar", "conhecimento", "salvar", "encaminhar", "mandar", "enviar", "repassar"],
  requires: { connector: ["google", "microsoft"] },
  inputSchema: UsarAnexo,
  // o resto é o arquivo, o destino resolvido e os números lidos dele: só a mensagem que acompanha se corrige no cartão
  camposEditaveis: ["mensagem"],
  preparar: prepararUso,
  summarize: resumoDoUso,
  run: async (i, ctx) => {
    const { userId } = ctx;
    try {
      if (i.como === "boleto") {
        if (!i.valor) return "A proposta chegou sem o valor do boleto. Peça de novo.";
        const r = await rodarFinancas("adicionar_conta", { descricao: (i.beneficiario || i.nome_arquivo || "Boleto").slice(0, 120), valor: i.valor, tipo: "a_pagar", ...(i.vencimento ? { vencimento: i.vencimento } : {}), todo_mes: false }, ctx);
        return { cadastrado: r, linha_digitavel: linhaLegivel(i.linha) };
      }
      if (i.como === "cupom" && i.valor) {
        return rodarFinancas("registrar_gasto", { valor: i.valor, descricao: (i.beneficiario || "Compra da nota fiscal").slice(0, 120), ...(i.data ? { data: i.data } : {}) }, ctx);
      }
      const arquivo = await bytesConferidos(userId, i);
      if (typeof arquivo === "string") return arquivo;
      const { enqueueJob } = await import("../../jobs/queue");
      // a mesma chave da tela e do WhatsApp (sha curto): o mesmo arquivo por dois caminhos é UM trabalho
      const sha = i.sha256!.slice(0, 24);
      const nome = i.nome_arquivo || "anexo";
      // o remetente e a autenticação que o `preparar` fixou: o trabalho escolhe por eles a senha
      // cadastrada (a senha mesma nunca vai no pedido)
      const doEmail = { remetente: i.remetente ?? "", autenticacao: i.autenticacao_email ?? "" };
      if (i.como === "cupom") {
        await enqueueJob(userId, { kind: "financas.cupom", input: arquivo.dataUrl, payload: { avisar: true, ...doEmail }, dedupKey: `cupom:${userId}:${sha}` });
        return "Lendo o comprovante. Aviso quando lançar.";
      }
      if (i.como === "extrato") {
        // OFX, CSV e planilha são lidos pelo motor (`finance/extrato.ts`), sem modelo; PDF e foto, pelo modelo (I8)
        await enqueueJob(userId, { kind: "financas.extrato", input: arquivo.dataUrl, payload: { nome, avisar: true, ...doEmail }, dedupKey: `extrato:${userId}:${sha}` });
        return "Importando o extrato. Aviso quando terminar.";
      }
      if (i.como === "encaminhar") return encaminhar(userId, i, { bytes: arquivo.bytes, mime: arquivo.mime, nome });
      await enqueueJob(userId, { kind: "rag.indexar_arquivo", input: arquivo.dataUrl, payload: { nome, avisar: true, ...doEmail }, dedupKey: `indexar:${userId}:${sha}` });
      return "Guardando no conhecimento. Aviso quando terminar.";
    } catch (e) {
      log.warn("anexos.usar_falhou", { como: i.como, erro: e instanceof Error ? e.message.slice(0, 200) : String(e) });
      return "Não consegui usar esse anexo agora. Tente de novo em instantes.";
    }
  },
};

registerTools([ler_email, ler_anexo, usar_anexo]);
