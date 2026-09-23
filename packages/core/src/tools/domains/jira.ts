import { z } from "zod";
import { contaParaEscrever, lerDeTodasAsContas } from "../../connectors/multi";
import { buscarIssues, comentarIssue, criarIssue, minhasIssues, mudarStatus } from "../../connectors/jira";
import { registerTools, type ToolDef } from "../registry";

/**
 * Domínio: Jira (Atlassian).
 *
 * O `cloudid` do site vive no `externalId` da conexão, e é ele que monta a URL
 * da API. Por isso toda chamada aqui passa por `conexao.externalId`: é o que
 * permite ter o Jira da empresa e o de um cliente ao mesmo tempo.
 *
 * Multi-conta segue a regra de `connectors/multi.ts`: ler varre todos os
 * workspaces, escrever usa um só.
 */

const CONTA = z.string().optional().describe("qual workspace do Jira usar; vazio usa o principal");

async function escrever(userId: string, conta?: string) {
  const r = await contaParaEscrever("jira", userId, conta);
  if ("erro" in r) throw new Error(r.contas?.length ? `${r.erro} Workspaces: ${r.contas.join(", ")}.` : r.erro);
  return r;
}

export const jira_minhas_tarefas: ToolDef<z.ZodObject<{ quantidade: z.ZodDefault<z.ZodNumber> }>> = {
  name: "jira_minhas_tarefas",
  domain: "jira",
  description: "Lista as issues do Jira atribuídas ao usuário que ainda não foram concluídas, de todos os workspaces conectados.",
  risk: "leitura",
  keywords: ["jira", "issue", "ticket", "sprint", "board", "atribuída", "o que tenho para fazer"],
  requires: { connector: "jira" },
  inputSchema: z.object({ quantidade: z.number().int().min(1).max(25).default(10) }),
  run: async ({ quantidade }, { userId }) => {
    const r = await lerDeTodasAsContas("jira", userId, (t, c) => minhasIssues(t, c.externalId, quantidade));
    if (r.contas === 0) return { erro: "Jira não conectado" };
    return { issues: r.itens, workspaces_lidos: r.contas, workspaces_que_falharam: r.falhas };
  },
};

export const jira_buscar: ToolDef<z.ZodObject<{ jql: z.ZodString; quantidade: z.ZodDefault<z.ZodNumber> }>> = {
  name: "jira_buscar",
  domain: "jira",
  description:
    "Busca issues no Jira usando JQL (ex.: 'project = ORB AND status = \"In Progress\"', 'reporter = currentUser() ORDER BY created DESC'). Use quando o pedido for mais específico do que 'minhas tarefas'.",
  risk: "leitura",
  keywords: ["jira", "buscar", "procurar", "jql", "issue", "ticket", "projeto", "sprint"],
  requires: { connector: "jira" },
  inputSchema: z.object({ jql: z.string().min(1).max(500), quantidade: z.number().int().min(1).max(25).default(10) }),
  run: async ({ jql, quantidade }, { userId }) => {
    const r = await lerDeTodasAsContas("jira", userId, (t, c) => buscarIssues(t, c.externalId, jql, quantidade));
    if (r.contas === 0) return { erro: "Jira não conectado" };
    return { issues: r.itens, workspaces_lidos: r.contas, workspaces_que_falharam: r.falhas };
  },
};

const CriarInput = z.object({
  projeto: z.string().describe("a CHAVE do projeto, ex.: ORB"),
  titulo: z.string(),
  descricao: z.string().optional(),
  tipo: z.string().optional().describe("Task, Bug, Story… (padrão Task)"),
  conta: CONTA,
});

export const jira_criar_tarefa: ToolDef<typeof CriarInput> = {
  name: "jira_criar_tarefa",
  domain: "jira",
  // criar issue aparece para o time inteiro: é efeito externo, vai para o gate
  description:
    "Propõe a criação de uma issue no Jira. Não cria direto: enfileira uma proposta para o usuário aprovar no painel 'Ações a confirmar'.",
  risk: "efeito_externo",
  keywords: ["jira", "criar", "abrir", "issue", "ticket", "tarefa", "bug", "card"],
  requires: { connector: "jira" },
  inputSchema: CriarInput,
  summarize: ({ projeto, titulo, conta }) => `Criar issue em ${projeto}: "${titulo}"${conta ? ` (${conta})` : ""}`,
  run: async ({ projeto, titulo, descricao, tipo, conta }, { userId }) => {
    const { token, conexao, rotulo } = await escrever(userId, conta);
    const r = await criarIssue(token, conexao.externalId, { projeto, titulo, descricao, tipo });
    return `Issue ${r.chave} criada no Jira (${rotulo}).`;
  },
};

const ComentarInput = z.object({ chave: z.string().describe("ex.: ORB-123"), texto: z.string(), conta: CONTA });

export const jira_comentar: ToolDef<typeof ComentarInput> = {
  name: "jira_comentar",
  domain: "jira",
  description: "Propõe um comentário numa issue do Jira. Não comenta direto: enfileira uma proposta para o usuário aprovar.",
  risk: "efeito_externo",
  keywords: ["jira", "comentar", "comentário", "responder", "issue", "ticket"],
  requires: { connector: "jira" },
  inputSchema: ComentarInput,
  summarize: ({ chave, texto }) => `Comentar em ${chave}: "${texto.slice(0, 80)}"`,
  run: async ({ chave, texto, conta }, { userId }) => {
    const { token, conexao, rotulo } = await escrever(userId, conta);
    await comentarIssue(token, conexao.externalId, chave, texto);
    return `Comentário adicionado em ${chave} (${rotulo}).`;
  },
};

const StatusInput = z.object({ chave: z.string(), status: z.string().describe("o nome do status de destino, ex.: 'Em andamento', 'Concluído'"), conta: CONTA });

export const jira_mudar_status: ToolDef<typeof StatusInput> = {
  name: "jira_mudar_status",
  domain: "jira",
  description:
    "Propõe mudar o status de uma issue do Jira. Não muda direto: enfileira uma proposta para o usuário aprovar. Se o status não for possível, devolve os que são.",
  risk: "efeito_externo",
  keywords: ["jira", "status", "mover", "concluir", "fechar", "andamento", "issue", "ticket"],
  requires: { connector: "jira" },
  inputSchema: StatusInput,
  summarize: ({ chave, status }) => `Mudar ${chave} para "${status}"`,
  run: async ({ chave, status, conta }, { userId }) => {
    const { token, conexao, rotulo } = await escrever(userId, conta);
    const r = await mudarStatus(token, conexao.externalId, chave, status);
    // o Jira só aceita transições válidas a partir do estado atual: devolver as
    // opções é mais útil do que um erro seco
    if ("erro" in r) return `${r.erro} Dá para mover para: ${r.opcoes.join(", ") || "nada a partir daqui"}.`;
    return `${chave} movida para "${status}" (${rotulo}).`;
  },
};

registerTools([jira_minhas_tarefas, jira_buscar, jira_criar_tarefa, jira_comentar, jira_mudar_status]);
