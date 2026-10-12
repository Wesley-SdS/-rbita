import { z } from "zod";
import { registerTools, type ToolDef } from "../registry";
import { settings } from "../../settings";
import { listaLimpa, normalizarApp, normalizarSite, type AlvoDaSessao } from "../../controle/envelope";
import { abrirSessao, encerrarSessao, maquinaLocal, sessaoAtual } from "../../controle/sessao";
import { resumoDoControle } from "../../controle/resumo";

/**
 * Domínio CONTROLE (PRD-COMPUTADOR-E-NAVEGADOR F2): abrir, ver e encerrar a
 * sessão de controle. É sensível pelo nome do domínio (`controle/dominios.ts`):
 * só o dono, só nos canais liberados, com trilha.
 *
 * Não existe, e não pode existir, tool que AMPLIE um envelope, mude site ou app
 * liberado ou mexa em permissão (PRD §2.3, o furo do `update_plan`). Ampliar é
 * propor um envelope novo, que passa pela fila como o primeiro.
 */

const CANAIS = ["tela", "voz", "whatsapp", "telegram"] as const;

const IniciarSchema = z.object({
  objetivo: z.string().trim().min(3).max(300).describe("O que a Órbita vai fazer, em uma frase (\"preencher o reembolso com o cupom de ontem\")."),
  alvo: z.enum(["computador", "navegador", "ambos"]).describe("Onde ela vai agir: no Windows, no Chrome, ou nos dois."),
  apps: z.array(z.string().trim().min(1).max(80)).max(20).nullish().describe("Apps do Windows que ela pode usar (\"VS Code\", \"Excel\"). Obrigatório para computador."),
  sites: z.array(z.string().trim().min(1).max(253)).max(20).nullish().describe("Sites que ela pode usar (\"jira.atlassian.net\"). Obrigatório para navegador."),
  tetoPassos: z.number().int().min(1).max(500).nullish().describe("Quantas ações no máximo. Vazio usa o padrão de Ajustes."),
  tetoMinutos: z.number().int().min(1).max(240).nullish().describe("Por quantos minutos. Vazio usa o padrão de Ajustes."),
  pedidoOriginal: z.string().trim().max(2000).nullish().describe("O pedido do dono com as palavras dele. A Órbita preenche sozinha quando o canal traz a mensagem."),
  // fixados pelo `preparar`: o que o modelo mandar aqui é sobrescrito
  pedidoLiteral: z.boolean().nullish().describe("Preenchido pela Órbita. Deixe vazio."),
  canal: z.enum(CANAIS).nullish().describe("Preenchido pela Órbita. Deixe vazio."),
  maquina: z.string().max(120).nullish().describe("Preenchido pela Órbita. Deixe vazio."),
});
type Iniciar = z.infer<typeof IniciarSchema>;

const ALVO_LEGIVEL: Record<AlvoDaSessao, string> = { computador: "no computador", navegador: "no Chrome", ambos: "no computador e no Chrome" };

export function resumoDoEnvelope(e: Iniciar): string {
  const partes = [`Abrir sessão de controle ${ALVO_LEGIVEL[e.alvo]}: "${e.objetivo}".`];
  if (e.apps?.length) partes.push(`Apps: ${e.apps.join(", ")}.`);
  if (e.sites?.length) partes.push(`Sites: ${e.sites.join(", ")}.`);
  partes.push(`Até ${e.tetoPassos} passos em ${e.tetoMinutos} min.`);
  if (e.pedidoOriginal) partes.push(`${e.pedidoLiteral ? "Pedido" : "Pedido, como a Órbita entendeu"}: "${e.pedidoOriginal.slice(0, 200)}".`);
  return partes.join(" ");
}

export const controle_iniciar: ToolDef<typeof IniciarSchema> = {
  name: "controle_iniciar",
  domain: "controle",
  description:
    "Propõe ao dono uma SESSÃO DE CONTROLE para a Órbita agir no computador ou no Chrome (clicar, digitar, abrir). Use antes de qualquer ação na tela: sem sessão aprovada, as ações são recusadas. Diga o objetivo, onde (computador, navegador ou ambos) e os apps ou sites que vai usar. O dono aprova o envelope; o que tiver efeito fora da tela continua pedindo aprovação dentro da sessão.",
  risk: "efeito_externo",
  keywords: ["controle", "computador", "pc", "navegador", "chrome", "sessao", "clicar", "digitar", "abrir", "mexer", "tela"],
  inputSchema: IniciarSchema,
  // apps, sites, canal, máquina e o pedido literal são o envelope que o código montou; o dono ajusta o objetivo e os tetos
  camposEditaveis: ["objetivo", "tetoPassos", "tetoMinutos"],
  async authorize(input) {
    if ((input.alvo === "computador" || input.alvo === "ambos") && !listaLimpa(input.apps ?? [], normalizarApp).length) return "Diga quais apps do Windows a sessão vai usar (por exemplo \"VS Code\").";
    if ((input.alvo === "navegador" || input.alvo === "ambos") && !listaLimpa(input.sites ?? [], normalizarSite).length) return "Diga quais sites a sessão vai usar (por exemplo \"jira.atlassian.net\").";
    return null;
  },
  async preparar(input, ctx) {
    const cfg = await settings.getMany(["controle.tetoPassos", "controle.tetoMinutos"]);
    // o pedido LITERAL vem do código (a mensagem que chegou), nunca do modelo;
    // sem ele (voz em tempo real), fica o resumo do modelo, marcado como tal
    const literal = ctx.pedido?.trim();
    return {
      objetivo: input.objetivo,
      alvo: input.alvo,
      apps: input.alvo === "navegador" ? [] : [...new Set((input.apps ?? []).map((a) => a.trim()).filter((a) => normalizarApp(a)))],
      sites: input.alvo === "computador" ? [] : listaLimpa(input.sites ?? [], normalizarSite),
      tetoPassos: input.tetoPassos ?? cfg["controle.tetoPassos"],
      tetoMinutos: input.tetoMinutos ?? cfg["controle.tetoMinutos"],
      pedidoOriginal: (literal || input.pedidoOriginal?.trim() || input.objetivo).slice(0, 2000),
      pedidoLiteral: Boolean(literal),
      canal: ctx.canal ?? "tela",
      maquina: maquinaLocal(),
    };
  },
  summarize: (e) => resumoDoEnvelope(e),
  // só roda depois da aprovação (POST /api/actions, "manda", botão do Telegram),
  // e só com o que está no payload: a sessão nasce do envelope que o dono viu
  async run(e, ctx) {
    const s = await abrirSessao(ctx.userId, {
      alvo: e.alvo,
      objetivo: e.objetivo,
      pedidoOriginal: e.pedidoOriginal ?? e.objetivo,
      pedidoLiteral: e.pedidoLiteral === true,
      apps: e.apps ?? [],
      sites: e.sites ?? [],
      tetoPassos: e.tetoPassos ?? (await settings.get("controle.tetoPassos")),
      tetoMinutos: e.tetoMinutos ?? (await settings.get("controle.tetoMinutos")),
      canal: e.canal ?? "tela",
      maquina: e.maquina ?? undefined,
    }, ctx.acaoId ?? null);
    const ate = s.expiraEm.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    return { mensagem: `Sessão aberta: "${s.objetivo}", até ${s.tetoPassos} passos ou ${ate}.`, sessaoId: s.id, controle: await resumoDoControle(ctx.userId) };
  },
};

const StatusSchema = z.object({});

export const controle_status: ToolDef<typeof StatusSchema> = {
  name: "controle_status",
  domain: "controle",
  description: "Diz se há uma sessão de controle do PC aberta: objetivo, passos usados e o teto, até quando vale, e o último passo. Use antes de agir no computador ou no Chrome e quando o dono perguntar o que a Órbita está fazendo.",
  risk: "leitura",
  keywords: ["controle", "sessao", "status", "computador", "navegador", "passos"],
  inputSchema: StatusSchema,
  async run(_i, ctx) {
    const r = await resumoDoControle(ctx.userId);
    if (!r) return { controle: null, mensagem: "Não há sessão de controle aberta. Para agir no computador ou no Chrome, proponha uma com controle_iniciar." };
    return { controle: r, mensagem: `Sessão ${r.status}: "${r.objetivo}", passo ${r.passosUsados} de ${r.tetoPassos}.` };
  },
};

const EncerrarSchema = z.object({ motivo: z.string().trim().max(200).nullish().describe("Por que terminou (\"tarefa concluída\").") });

export const controle_encerrar: ToolDef<typeof EncerrarSchema> = {
  name: "controle_encerrar",
  domain: "controle",
  description: "Encerra a sessão de controle do PC quando a tarefa terminou ou o dono pediu. Depois disso a Órbita não age mais na tela até uma sessão nova ser aprovada.",
  risk: "escrita",
  keywords: ["controle", "encerrar", "terminar", "sessao", "pronto"],
  inputSchema: EncerrarSchema,
  async run(i, ctx) {
    const s = await sessaoAtual(ctx.userId, true);
    if (!s) return { mensagem: "Não há sessão de controle aberta." };
    await encerrarSessao(ctx.userId, s.id, i.motivo?.trim() || "encerrada pela Órbita");
    return { mensagem: `Sessão encerrada: "${s.objetivo}", ${s.passosUsados} passos.` };
  },
};

registerTools([controle_iniciar, controle_status, controle_encerrar]);
