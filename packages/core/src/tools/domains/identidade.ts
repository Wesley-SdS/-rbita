import { z } from "zod";
import { registerTools, type ToolContext, type ToolDef } from "../registry";
import { askContext, canAskAndAudit, findPersonByName, visiblePeople } from "../../identity/ask";
import { currentPresence } from "../../identity/presence";
import { createPerson, listPeople, currentTerm } from "../../identity/people";
// fachada: tool dispara operação de identidade, nunca toca em vetor ou amostra (NV.1)
import { apagarBiometriaDe, usarFalaComoAmostra } from "../../identity/actions";
import { cameraDigest, findObject, knownObjectLabels } from "../../vision/objects";
import { quemDisse } from "../../meetings/quem-disse";
import { cameraRoomName, findCamera, latestEventWithSnapshot } from "../../cameras/query";
import { imagemFresca } from "../../cameras/fresca";
import { allowedRooms, authorizeRoomForRequester } from "../../home/room-permission";
import { narrateCameraEvent, narrateSnapshot } from "../../cameras/narrate";
import { db } from "@orbita/db";
import { document } from "@orbita/db/knowledge-schema";
import { and, eq } from "drizzle-orm";

/**
 * Domínio IDENTIDADE (Onda 11, PRD §8). O que a Órbita passa a saber responder
 * quando sabe quem é quem.
 *
 * Três invariantes aqui:
 *   1. perguntar sobre OUTRA pessoa passa por permissão e vai para a trilha
 *      (PRD §4.7), inclusive quando é negado;
 *   2. nada afirma sem confiança: presença velha sai como "visto por último" e
 *      identificação fraca sai como "provavelmente";
 *   3. cadastrar pessoa e apagar biometria são PERIGOSOS: o gate do registro os
 *      manda para a fila de aprovação do dono, o modelo nunca executa direto.
 */

const quem = async (ctx: ToolContext) => (ctx.requester ? await ctx.requester().catch(() => null) : null);

/**
 * Olhar a câmera de um cômodo é tão restrito quanto agir nele: sem isso, um
 * visitante perguntaria "o que está acontecendo no quarto" e a descrição viria.
 */
const autorizarCamera = (oQue: string) => async (input: { comodo?: string; local?: string }, ctx: ToolContext) => {
  const cam = await findCamera(ctx.userId, input.comodo ?? input.local ?? "");
  if (!cam) return null; // câmera inexistente: a própria tool responde
  return authorizeRoomForRequester(cam.roomId, await quem(ctx), oQue);
};

// ── quem está em casa ───────────────────────────────────────────────────────

export const quem_esta_em_casa: ToolDef<z.ZodObject<Record<string, never>>> = {
  name: "quem_esta_em_casa",
  domain: "identidade",
  description: "Diz quais pessoas da casa foram vistas e em qual cômodo, com quando foram vistas. Use para 'quem está em casa?', 'a Anna chegou?', 'tem alguém na sala?'.",
  risk: "leitura",
  keywords: ["quem está", "em casa", "chegou", "saiu", "presença", "alguém"],
  inputSchema: z.object({}),
  run: async (_i, ctx) => {
    const askCtx = await askContext(ctx.userId, await quem(ctx));
    const permitidas = await visiblePeople(ctx.userId, askCtx, "quem_esta_em_casa");
    if (!permitidas.length) return { pessoas: [], aviso: "Ninguém que você possa consultar tem presença registrada." };
    const presenca = await currentPresence(ctx.userId);
    const porPessoa = new Map(presenca.map((p) => [p.personId, p]));
    return {
      pessoas: permitidas.map((p) => {
        const v = porPessoa.get(p.id);
        if (!v) return { nome: p.name, visto: "sem registro" };
        return { nome: p.name, comodo: v.roomName ?? "cômodo não definido", quando: v.quando, vistoEm: v.seenAt, confianca: v.confidence ?? undefined, origem: v.source };
      }),
    };
  },
};

const OndeInput = z.object({ pessoa: z.string().min(1).max(80).describe("nome ou apelido da pessoa") });
export const onde_esta: ToolDef<typeof OndeInput> = {
  name: "onde_esta",
  domain: "identidade",
  description: "Diz em que cômodo uma pessoa da casa foi vista por último, e há quanto tempo. Exige permissão para perguntar sobre outra pessoa.",
  risk: "leitura",
  keywords: ["onde está", "onde a", "onde o", "cadê", "em qual cômodo"],
  inputSchema: OndeInput,
  run: async ({ pessoa }, ctx) => {
    const askCtx = await askContext(ctx.userId, await quem(ctx));
    const alvo = findPersonByName(askCtx.people, pessoa);
    if (!alvo) return { erro: `Não encontrei "${pessoa}" entre as pessoas da casa.` };
    if (!(await canAskAndAudit(ctx.userId, askCtx, alvo, "onde_esta"))) return { erro: `Você não tem permissão para perguntar sobre ${alvo.name}.` };
    const v = (await currentPresence(ctx.userId)).find((p) => p.personId === alvo.id);
    if (!v) return { pessoa: alvo.name, resposta: "Sem registro de onde foi vista." };
    return { pessoa: alvo.name, comodo: v.roomName ?? "cômodo não definido", quando: v.quando, vistoEm: v.seenAt, confianca: v.confidence ?? undefined, origem: v.source, emCasa: v.quando !== "antigo" };
  },
};

// ── o que está acontecendo / ver câmera ─────────────────────────────────────

const AcontecendoInput = z.object({ comodo: z.string().min(1).max(60).describe("nome do cômodo ou da câmera") });
export const o_que_esta_acontecendo: ToolDef<typeof AcontecendoInput> = {
  name: "o_que_esta_acontecendo",
  domain: "identidade",
  description: "Descreve o que está acontecendo num cômodo agora: quem está lá (se reconhecido) e a cena da câmera. Roda o modelo de visão numa imagem só, sob demanda.",
  risk: "leitura",
  keywords: ["o que está acontecendo", "como está", "a cena", "na sala", "na cozinha"],
  inputSchema: AcontecendoInput,
  authorize: autorizarCamera("ver a câmera"),
  run: async ({ comodo }, ctx) => {
    const cam = await findCamera(ctx.userId, comodo);
    if (!cam) return { erro: `Não achei uma câmera para "${comodo}".` };
    const [ev, askCtx, nomeComodo] = await Promise.all([latestEventWithSnapshot(cam.id), askContext(ctx.userId, await quem(ctx)), cameraRoomName(cam)]);
    if (!ev?.snapshot) return { erro: `A câmera "${cam.name}" ainda não tem imagem recente.` };
    // narração já gravada no evento é reaproveitada (com modelo local, narrar de
    // novo custa dezenas de segundos); a regra de "só local" vive no narrate
    const descricao = await narrateCameraEvent(ev.id);

    const presenca = await currentPresence(ctx.userId);
    const permitidas = new Set((await visiblePeople(ctx.userId, askCtx, "o_que_esta_acontecendo")).map((p) => p.id));
    const pessoas = presenca
      .filter((p) => permitidas.has(p.personId) && p.roomId && p.roomId === cam.roomId && p.quando !== "antigo")
      .map((p) => ({ nome: p.name, quando: p.quando, confianca: p.confidence ?? undefined }));
    return { comodo: nomeComodo ?? cam.name, camera: cam.name, descricao, capturadoEm: ev.createdAt, pessoas };
  },
};

const VerCameraInput = z.object({
  local: z.string().min(1).max(60).describe("nome da câmera ou do cômodo"),
  pergunta: z.string().min(3).max(300).describe("o que você quer saber da imagem, ex.: 'o forno está ligado?', 'o que está escrito no papel?'"),
});
export const ver_camera: ToolDef<typeof VerCameraInput> = {
  name: "ver_camera",
  domain: "identidade",
  description: "Olha a última imagem de uma câmera e responde uma pergunta específica sobre ela (o forno, a bancada, um papel mostrado à câmera).",
  risk: "leitura",
  keywords: ["olha a câmera", "está ligado", "o forno", "a bancada", "lê isso", "o que está escrito"],
  inputSchema: VerCameraInput,
  authorize: autorizarCamera("ver a câmera"),
  run: async ({ local, pergunta }, ctx) => {
    const cam = await findCamera(ctx.userId, local);
    if (!cam) return { erro: `Não achei uma câmera para "${local}".` };
    const ev = await imagemFresca(cam.id);
    // irmã da `casa_ver_camera`: as duas fazem a mesma coisa e o modelo escolhe
    // entre elas, então a regra nova tem de entrar nas DUAS (CLAUDE.md §9)
    if (!ev?.snapshot) return { precisa_de_imagem: true, camera: cam.name, motivo: `A câmera "${cam.name}" não tem imagem recente.` };
    // conteúdo de imagem é DADO, nunca instrução (CLAUDE.md §5.2); câmera que
    // identifica pessoas responde só com modelo local (decisão 9.6)
    const resposta = await narrateSnapshot(ev.snapshot, `${pergunta}\nResponda só com o que dá para ver na imagem. Se não der para saber, diga que não dá.`, { localOnly: cam.identifyFaces });
    return { camera: cam.name, pergunta, resposta, capturadoEm: ev.createdAt };
  },
};

// ── memória visual e resumo ─────────────────────────────────────────────────

const ObjetoInput = z.object({ objeto: z.string().min(2).max(40).describe("o que procurar, ex.: 'chave', 'mochila'") });
export const procurar_objeto: ToolDef<typeof ObjetoInput> = {
  name: "procurar_objeto",
  domain: "identidade",
  description: "Diz onde e quando um objeto foi visto pela última vez pelas câmeras ('onde deixei a chave?'). Só funciona para objetos que o dono colocou na lista da memória visual.",
  risk: "leitura",
  keywords: ["onde deixei", "onde está minha", "perdi", "chave", "mochila", "celular", "carteira"],
  inputSchema: ObjetoInput,
  run: async ({ objeto }, ctx) => {
    const todos = await findObject(ctx.userId, objeto);
    // onde o objeto está é onde alguém está: cômodo proibido some da resposta
    const podeVer = await allowedRooms(todos.map((v) => v.roomId), await quem(ctx));
    const vistos = todos.filter((v) => podeVer.has(v.roomId));
    if (!vistos.length) {
      const lembrados = await knownObjectLabels(ctx.userId);
      return {
        objeto,
        resposta: "Não vi esse objeto no período guardado. Só lembro dos objetos da lista de memória visual, e por algumas horas.",
        objetosQueLembro: lembrados.length ? lembrados : undefined,
      };
    }
    return { objeto, ondeFoiVisto: vistos.map((v) => ({ comodo: v.roomName ?? v.cameraName ?? "sem cômodo", zona: v.zone ?? undefined, quando: v.seenAt, confianca: v.score ?? undefined })) };
  },
};

const ResumoInput = z.object({ horas: z.number().int().min(1).max(168).default(12).describe("quantas horas para trás resumir") });
export const resumo_do_dia_cameras: ToolDef<typeof ResumoInput> = {
  name: "resumo_do_dia_cameras",
  domain: "identidade",
  description: "Resume o que as câmeras viram num período, com nomes de quem foi reconhecido ('o que aconteceu enquanto eu estava fora?').",
  risk: "leitura",
  keywords: ["o que aconteceu", "enquanto eu estava fora", "resumo do dia", "câmeras hoje"],
  inputSchema: ResumoInput,
  run: async ({ horas }, ctx) => {
    const askCtx = await askContext(ctx.userId, await quem(ctx));
    const permitidas = new Set((await visiblePeople(ctx.userId, askCtx, "resumo_do_dia_cameras")).map((p) => p.id));
    const nomes = new Map(askCtx.people.map((p) => [p.id, p.name]));
    const ate = new Date();
    const todos = await cameraDigest(ctx.userId, new Date(ate.getTime() - horas * 3_600_000), ate);
    // o evento em si já entrega o cômodo ("movimento no quarto às 2h"): sem
    // permissão sobre o cômodo, ele não aparece, não basta esconder o nome
    const podeVer = await allowedRooms(todos.map((e) => e.roomId), await quem(ctx));
    const eventos = todos.filter((e) => podeVer.has(e.roomId));
    if (!eventos.length) return { periodoHoras: horas, eventos: [], resposta: "Nenhuma câmera registrou nada nesse período." };
    return {
      periodoHoras: horas,
      eventos: eventos.map((e) => ({
        quando: e.createdAt,
        comodo: e.roomName ?? e.cameraName,
        oQue: e.label,
        // sem permissão sobre a pessoa, o evento continua aparecendo, mas sem o nome
        quem: e.personId && permitidas.has(e.personId) ? (nomes.get(e.personId) ?? null) : e.personId ? "alguém da casa" : (e.desconhecido ?? null),
        certeza: e.outcome ?? undefined,
        // a narração descreve a pessoa ("mulher de cabelo escuro cozinhando"):
        // esconder só o nome não esconderia nada
        descricao: e.personId && !permitidas.has(e.personId) ? undefined : (e.narration ?? undefined),
      })),
    };
  },
};

// ── reuniões ────────────────────────────────────────────────────────────────

const QuemDisseInput = z.object({
  assunto: z.string().min(3).max(200).describe("o que foi dito, ex.: 'entrega na sexta'"),
  pessoa: z.string().max(80).nullable().default(null).describe("limitar a uma pessoa, se souber"),
});
export const quem_disse: ToolDef<typeof QuemDisseInput> = {
  name: "quem_disse",
  domain: "identidade",
  description: "Procura quem disse algo nas reuniões já transcritas, com o trecho da fala e a reunião. Use para 'quem disse que entregava na sexta?'.",
  risk: "leitura",
  keywords: ["quem disse", "quem falou", "quem prometeu", "na reunião"],
  inputSchema: QuemDisseInput,
  run: async ({ assunto, pessoa }, ctx) => {
    const askCtx = await askContext(ctx.userId, await quem(ctx));
    // quem não pode consultar a pessoa recebe a fala SEM o nome (a fala é da
    // reunião do dono; o nome é que é dado sobre outra pessoa)
    const permitidas = new Set((await visiblePeople(ctx.userId, askCtx, "quem_disse")).map((p) => p.name.toLowerCase()));
    if (pessoa && !permitidas.has(pessoa.toLowerCase())) return { erro: `Você não tem permissão para perguntar sobre ${pessoa}.` };
    const falas = await quemDisse(ctx.userId, assunto, { nome: pessoa });
    if (!falas.length) return { assunto, resposta: "Não achei ninguém dizendo isso nas reuniões transcritas." };
    return {
      assunto,
      falas: falas.map((f) => ({
        quem: f.nome && permitidas.has(f.nome.toLowerCase()) ? f.nome : `Locutor ${f.locutor}`,
        trecho: f.trecho,
        reuniao: f.titulo,
        quando: f.quando,
      })),
    };
  },
};

const NomearInput = z.object({
  reuniaoId: z.string().uuid().describe("id do documento da reunião"),
  locutor: z.string().min(1).max(4).describe("etiqueta do locutor, ex.: 'A'"),
  pessoa: z.string().min(1).max(80).describe("nome da pessoa da casa"),
});
export const nomear_locutor: ToolDef<typeof NomearInput> = {
  name: "nomear_locutor",
  domain: "identidade",
  description: "Associa um locutor de uma reunião ('Locutor A') a uma pessoa cadastrada. Não usa a fala como amostra de voz: isso é feito na tela, com consentimento.",
  risk: "escrita",
  keywords: ["locutor a", "quem é o locutor", "nomear locutor", "esse é o"],
  inputSchema: NomearInput,
  summarize: ({ locutor, pessoa }) => `Nomear locutor ${locutor} como ${pessoa}`,
  run: async ({ reuniaoId, locutor, pessoa }, ctx) => {
    const askCtx = await askContext(ctx.userId, await quem(ctx));
    const alvo = findPersonByName(askCtx.people, pessoa);
    if (!alvo) return { erro: `Não encontrei "${pessoa}" entre as pessoas da casa.` };
    const [doc] = await db.select({ id: document.id, speakers: document.speakers }).from(document).where(and(eq(document.id, reuniaoId), eq(document.userId, ctx.userId))).limit(1);
    if (!doc) return { erro: "Reunião não encontrada." };
    const speakers = { ...(doc.speakers ?? {}), [locutor.toUpperCase()]: alvo.name };
    await db.update(document).set({ speakers }).where(eq(document.id, doc.id));
    return { ok: true, locutor: locutor.toUpperCase(), pessoa: alvo.name };
  },
};

// ── perigosos: cadastro e apagamento ────────────────────────────────────────

const CadastrarInput = z.object({
  nome: z.string().min(1).max(80),
  relacao: z.enum(["morador", "visitante_frequente", "contato_externo"]).default("morador"),
  menorDeIdade: z.boolean().default(false),
});
export const cadastrar_pessoa: ToolDef<typeof CadastrarInput> = {
  name: "cadastrar_pessoa",
  domain: "identidade",
  description: "Cadastra uma pessoa da casa. NÃO cadastra biometria: voz e rosto exigem o termo de consentimento assinado na tela de pessoas.",
  risk: "perigoso",
  keywords: ["cadastrar pessoa", "adicionar pessoa", "nova pessoa da casa"],
  inputSchema: CadastrarInput,
  summarize: ({ nome, relacao, menorDeIdade }) => `Cadastrar ${nome} (${relacao}${menorDeIdade ? ", menor de idade" : ""})`,
  run: async ({ nome, relacao, menorDeIdade }, ctx) => {
    const { id } = await createPerson(ctx.userId, {
      name: nome,
      role: relacao === "morador" ? "morador" : "visitante",
      aliases: [],
      relation: relacao,
      isMinor: menorDeIdade,
      guardianPersonId: null,
      accountEmail: null,
    });
    const termo = await currentTerm();
    return {
      id,
      nome,
      aviso: "Pessoa cadastrada sem biometria. Para reconhecer por voz ou rosto, registre o consentimento na tela de pessoas.",
      termoVigente: termo.version,
    };
  },
};

const ApagarInput = z.object({ pessoa: z.string().min(1).max(80).describe("nome da pessoa") });
export const apagar_biometria: ToolDef<typeof ApagarInput> = {
  name: "apagar_biometria",
  domain: "identidade",
  description: "Apaga toda a biometria de uma pessoa: amostras, assinaturas de voz e rosto, referências em câmeras e identidades desconhecidas que eram ela. O cadastro dela continua.",
  risk: "perigoso",
  keywords: ["apagar biometria", "esquecer minha voz", "remover rosto", "apagar assinatura"],
  inputSchema: ApagarInput,
  summarize: ({ pessoa }) => `Apagar TODA a biometria de ${pessoa} (irreversível)`,
  run: async ({ pessoa }, ctx) => {
    const askCtx = await askContext(ctx.userId, await quem(ctx));
    const alvo = findPersonByName(askCtx.people, pessoa);
    if (!alvo) return { erro: `Não encontrei "${pessoa}" entre as pessoas da casa.` };
    const r = await apagarBiometriaDe(ctx.userId, alvo.id);
    return { ok: true, pessoa: alvo.name, tabelasLimpas: r.tabelas, referenciasZeradas: r.referencias, consentimentoRevogado: true };
  },
};

// ── cadastro de voz a partir de reunião (correção ensina) ───────────────────

const AmostraInput = z.object({
  pessoa: z.string().min(1).max(80),
  ref: z.string().uuid().nullable().default(null).describe("referência de uma fala de reunião; vazio usa o que a pessoa acabou de falar neste pedido"),
});
export const usar_fala_como_amostra: ToolDef<typeof AmostraInput> = {
  name: "usar_fala_como_amostra",
  domain: "identidade",
  description:
    "Guarda uma fala como amostra de voz de uma pessoa, se ela tiver consentimento de voz. Use depois de confirmar de quem é a voz: com a referência de uma fala de reunião, ou sem referência nenhuma para guardar o que a pessoa acabou de falar neste pedido.",
  risk: "escrita",
  keywords: ["usar como amostra", "essa voz é", "aprende a voz", "corrigir locutor"],
  inputSchema: AmostraInput,
  summarize: ({ pessoa }) => `Usar a fala da reunião como amostra de voz de ${pessoa}`,
  run: async ({ pessoa, ref }, ctx) => {
    const askCtx = await askContext(ctx.userId, await quem(ctx));
    const alvo = findPersonByName(askCtx.people, pessoa);
    if (!alvo) return { erro: `Não encontrei "${pessoa}" entre as pessoas da casa.` };
    // sem referência, vale a fala DESTE pedido (PRD §5.2: cadastrar no dia a
    // dia, depois de confirmar quem está falando). A referência vive poucos
    // minutos em memória, então isso só funciona no próprio turno.
    const referencia = ref?.trim() || (ctx.voiceRef ? await ctx.voiceRef().catch(() => null) : null);
    if (!referencia) {
      return { erro: "Não tenho uma fala para guardar. Peça de novo falando (o trecho de voz do pedido é o que vira amostra), ou diga qual fala da reunião usar." };
    }
    const r = await usarFalaComoAmostra(ctx.userId, alvo.id, referencia, ref?.trim() ? "correcao" : "comando");
    return "erro" in r ? r : { ok: true, pessoa: alvo.name, origem: ref?.trim() ? "reunião" : "o que você acabou de falar" };
  },
};

// listPeople entra aqui só para a tool de listagem simples da casa
const ListarInput = z.object({});
export const listar_pessoas_da_casa: ToolDef<typeof ListarInput> = {
  name: "listar_pessoas_da_casa",
  domain: "identidade",
  description: "Lista as pessoas cadastradas na casa, a relação de cada uma e se já têm voz ou rosto cadastrados.",
  risk: "leitura",
  keywords: ["pessoas da casa", "quem mora", "cadastradas", "moradores"],
  inputSchema: ListarInput,
  run: async (_i, ctx) => {
    const askCtx = await askContext(ctx.userId, await quem(ctx));
    const permitidas = new Set((await visiblePeople(ctx.userId, askCtx, "listar_pessoas_da_casa")).map((p) => p.id));
    const pessoas = (await listPeople(ctx.userId)).filter((p) => permitidas.has(p.id));
    return { pessoas: pessoas.map((p) => ({ nome: p.name, relacao: p.relation, menorDeIdade: p.isMinor, voz: p.consentimento.voz, rosto: p.consentimento.rosto })) };
  },
};

registerTools([
  quem_esta_em_casa,
  onde_esta,
  o_que_esta_acontecendo,
  ver_camera,
  procurar_objeto,
  resumo_do_dia_cameras,
  quem_disse,
  nomear_locutor,
  usar_fala_como_amostra,
  listar_pessoas_da_casa,
  cadastrar_pessoa,
  apagar_biometria,
]);

// Não existe tool de consentimento, de propósito: consentir é ato do dono na
// tela, com o termo à vista. O modelo pode cadastrar a pessoa, nunca consentir
// por ela (PRD §4.4). `recordConsent` fica só no caminho da rota.
