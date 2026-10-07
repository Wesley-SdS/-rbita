import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@orbita/db";
import { automationRule } from "@orbita/db/rule-schema";
import { routine } from "@orbita/db/routine-schema";
import { registerTools, type ToolDef } from "../registry";
import { settings } from "../../settings";
import { isOwner } from "../../owner";
import { cronError } from "../../rules/engine";

/**
 * Domínio: rotinas com HORÁRIO e o bom dia da manhã.
 *
 * Existe porque, em 06/10/2026, o dono pediu pela voz "todo dia às 7h me dá
 * bom dia em áudio com e-mails, trânsito, reuniões e tarefas", e a Órbita não
 * tinha como agendar nada: salvou uma MEMÓRIA dizendo isso e respondeu como
 * se tivesse criado a rotina. Memória não dispara às 7h. Agora o pedido vira
 * uma regra com horário (a mesma das telas de Regras) ou a configuração do bom
 * dia, e `listar_rotinas` mostra o que está de fato agendado.
 *
 * Criar rotina é ESCRITA do próprio dono, sem efeito fora de casa no ato; o que
 * a rotina fizer depois passa pelas regras de sempre (proposta e aprovação).
 */

const DIAS = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"] as const;
const Dia = z.enum(DIAS);
const Horario = z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/, "Use HH:MM, por exemplo 07:00.");

/** "07:30" + dias → "30 7 * * 1,3,5". Puro. */
export function cronDoHorario(horario: string, dias: "todos" | "uteis" | (typeof DIAS)[number][]): string {
  const [h, m] = horario.split(":").map(Number);
  const semana = dias === "todos" ? "*" : dias === "uteis" ? "1-5" : [...new Set(dias.map((d) => DIAS.indexOf(d)))].sort().join(",");
  return `${m} ${h} * * ${semana}`;
}

/** "30 7 * * 1,3,5" → "às 07:30, seg, qua e sex". Puro (só o formato que `cronDoHorario` gera). */
export function horarioLegivel(expr: string): string {
  const [m, h, , , semana] = expr.split(/\s+/);
  if (!m || !h || !/^\d+$/.test(m) || !/^\d+$/.test(h)) return expr;
  const hora = `às ${h.padStart(2, "0")}:${m.padStart(2, "0")}`;
  if (semana === "*") return `${hora}, todo dia`;
  if (semana === "1-5") return `${hora}, de segunda a sexta`;
  const nomes = (semana ?? "").split(",").map((n) => DIAS[Number(n)]).filter(Boolean);
  return `${hora}, ${nomes.length > 1 ? `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}` : nomes[0] ?? semana}`;
}

async function soDono(userId: string): Promise<string | null> {
  return (await isOwner(userId)) ? null : "Só o dono da Órbita pode mudar as rotinas da casa.";
}

const CriarRotina = z.object({
  nome: z.string().min(2).max(80).describe("um nome curto, ex.: Lembrete do remédio"),
  horario: Horario.describe("HH:MM no fuso da casa"),
  dias: z.union([z.enum(["todos", "uteis"]), z.array(Dia).min(1).max(7)]).describe('"todos", "uteis" (seg a sex) ou a lista, ex.: ["ter","qui"]'),
  pedido: z.string().min(5).max(2000).describe("o que a Órbita faz e manda no horário, escrito como um pedido a ela"),
});

export const criar_rotina: ToolDef<typeof CriarRotina> = {
  name: "criar_rotina",
  domain: "rotinas",
  description:
    "AGENDA algo que se repete num horário: no horário, a Órbita faz o pedido (com as ferramentas de leitura) e manda o resultado no WhatsApp e no app. Use para \"todo dia às 9h me lembra…\", \"toda segunda me manda…\". Para o bom dia da manhã, use configurar_bom_dia. Nunca diga que agendou sem esta ferramenta confirmar.",
  risk: "escrita",
  keywords: ["rotina", "agendar", "todo dia", "toda semana", "às", "horário", "lembrete recorrente", "automatizar"],
  inputSchema: CriarRotina,
  run: async ({ nome, horario, dias, pedido }, { userId }) => {
    const negado = await soDono(userId);
    if (negado) return { erro: negado };
    const expr = cronDoHorario(horario, dias);
    const invalido = cronError(expr);
    if (invalido) return { erro: invalido };
    const [r] = await db
      .insert(automationRule)
      .values({ userId, name: nome.trim(), enabled: true, trigger: { kind: "cron", expr }, conditions: [], actions: [{ kind: "prompt", prompt: pedido.trim() }] })
      .returning({ id: automationRule.id });
    return { criada: true, id: r!.id, nome: nome.trim(), quando: horarioLegivel(expr), mensagem: `Rotina "${nome.trim()}" agendada ${horarioLegivel(expr)}. Dá para ver e desligar em Rotinas e regras.` };
  },
};

export const listar_rotinas: ToolDef<z.ZodObject<Record<string, never>>> = {
  name: "listar_rotinas",
  domain: "rotinas",
  description: "O que está AGENDADO de verdade: o bom dia da manhã, as rotinas com horário e as rotinas periódicas. Use para conferir antes de dizer que algo está agendado, e para \"quais rotinas eu tenho?\".",
  risk: "leitura",
  keywords: ["rotinas", "agendado", "agendadas", "bom dia", "briefing", "automações", "regras"],
  inputSchema: z.object({}),
  run: async (_i, { userId }) => {
    const cfg = await settings.getMany(["whatsapp.briefingAtivo", "whatsapp.briefingHorario", "whatsapp.briefingDias", "whatsapp.briefingAudio", "casa.trabalhoPorDia"]);
    const comHorario = await db.select().from(automationRule).where(and(eq(automationRule.userId, userId), isNull(automationRule.builtinKey)));
    const periodicas = await db.select().from(routine).where(eq(routine.userId, userId));
    return {
      bom_dia: { ligado: cfg["whatsapp.briefingAtivo"], horario: cfg["whatsapp.briefingHorario"], dias: cfg["whatsapp.briefingDias"] === "uteis" ? "de segunda a sexta" : "todo dia", em_audio: cfg["whatsapp.briefingAudio"], trabalho_por_dia: cfg["casa.trabalhoPorDia"] },
      rotinas_com_horario: comHorario
        .filter((r) => (r.trigger as { kind?: string }).kind === "cron")
        .map((r) => ({ nome: r.name, ligada: r.enabled, quando: horarioLegivel((r.trigger as { expr: string }).expr) })),
      rotinas_periodicas: periodicas.map((r) => ({ nome: r.title, ligada: r.enabled, a_cada_minutos: r.intervalMinutes })),
    };
  },
};

const Desligar = z.object({ nome: z.string().min(2).max(80), ligar: z.boolean().optional().describe("true para religar") });
export const desligar_rotina: ToolDef<typeof Desligar> = {
  name: "desligar_rotina",
  domain: "rotinas",
  description: "Desliga (ou religa, com ligar=true) uma rotina com horário pelo nome. Não apaga: ela continua em Rotinas e regras.",
  risk: "escrita",
  keywords: ["desligar", "parar", "pausar", "religar", "rotina"],
  inputSchema: Desligar,
  run: async ({ nome, ligar }, { userId }) => {
    const negado = await soDono(userId);
    if (negado) return { erro: negado };
    const alvo = nome.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const todas = (await db.select().from(automationRule).where(and(eq(automationRule.userId, userId), isNull(automationRule.builtinKey)))).filter((r) => (r.trigger as { kind?: string }).kind === "cron");
    const achadas = todas.filter((r) => r.name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().includes(alvo));
    if (achadas.length !== 1) return { erro: achadas.length ? "Mais de uma rotina com esse nome. Qual delas?" : "Não achei rotina com esse nome.", rotinas: (achadas.length ? achadas : todas).map((r) => r.name) };
    await db.update(automationRule).set({ enabled: Boolean(ligar), updatedAt: new Date() }).where(eq(automationRule.id, achadas[0]!.id));
    return { mensagem: `Rotina "${achadas[0]!.name}" ${ligar ? "religada" : "desligada"}.` };
  },
};

const BomDia = z.object({
  ligado: z.boolean().optional(),
  horario: Horario.optional(),
  dias: z.enum(["todos", "uteis"]).optional(),
  em_audio: z.boolean().optional().describe("true: chega como nota de voz no WhatsApp"),
  pedido: z.string().min(10).max(2000).optional().describe("o que o bom dia deve trazer, escrito como pedido à Órbita"),
  trabalho_por_dia: z.array(z.string().min(4).max(120)).max(7).optional().describe('onde ele trabalha em cada dia, ex.: ["ter, qui: Companhia de Estágios", "seg, qua, sex: Adalink"]; o lugar é um dos lugares cadastrados'),
});

export const configurar_bom_dia: ToolDef<typeof BomDia> = {
  name: "configurar_bom_dia",
  domain: "rotinas",
  description:
    "Configura o bom dia da manhã no WhatsApp (o panorama do dia): ligar, horário, dias, em áudio ou texto, o que ele traz e onde o dono trabalha em cada dia (para o trânsito do dia certo). Use para \"todo dia às 7h me dá bom dia…\". Só mude o que ele pediu.",
  risk: "escrita",
  keywords: ["bom dia", "briefing", "manhã", "panorama", "resumo do dia", "áudio", "trabalho", "trânsito"],
  inputSchema: BomDia,
  run: async (p, { userId }) => {
    const negado = await soDono(userId);
    if (negado) return { erro: negado };
    const mudou: string[] = [];
    if (p.ligado !== undefined) { await settings.set("whatsapp.briefingAtivo", p.ligado); mudou.push(p.ligado ? "ligado" : "desligado"); }
    if (p.horario) { await settings.set("whatsapp.briefingHorario", p.horario.padStart(5, "0")); mudou.push(`às ${p.horario.padStart(5, "0")}`); }
    if (p.dias) { await settings.set("whatsapp.briefingDias", p.dias); mudou.push(p.dias === "uteis" ? "de segunda a sexta" : "todo dia"); }
    if (p.em_audio !== undefined) { await settings.set("whatsapp.briefingAudio", p.em_audio); mudou.push(p.em_audio ? "em áudio" : "em texto"); }
    if (p.pedido) { await settings.set("whatsapp.briefingPedido", p.pedido.trim()); mudou.push("com o conteúdo novo"); }
    if (p.trabalho_por_dia) { await settings.set("casa.trabalhoPorDia", p.trabalho_por_dia.map((l) => l.trim())); mudou.push("com o trabalho de cada dia"); }
    if (!mudou.length) return { erro: "Nada para mudar: diga o que quer no bom dia." };
    return { configurado: true, mensagem: `Bom dia configurado: ${mudou.join(", ")}.` };
  },
};

registerTools([criar_rotina, listar_rotinas, desligar_rotina, configurar_bom_dia]);
