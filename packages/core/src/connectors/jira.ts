/**
 * Cliente REST do Jira Cloud (Atlassian), via OAuth 2.0 3LO.
 *
 * A URL da API inclui o `cloudid` do site, que é o mesmo identificador que a
 * conexão guarda em `externalId`. Por isso toda função aqui recebe `cloudId`
 * junto do token: sem ele não há endpoint para chamar, e é também o que
 * permite ter dois workspaces de Jira conectados ao mesmo tempo.
 */

async function jira<T>(token: string, cloudId: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`https://api.atlassian.com/ex/jira/${encodeURIComponent(cloudId)}/rest/api/3${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`Jira ${res.status}: ${(await res.text()).slice(0, 200)}`);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface JiraIssue {
  chave: string;
  titulo: string;
  status: string;
  tipo: string;
  prioridade: string | null;
  responsavel: string | null;
  projeto: string;
  vencimento: string | null;
  atualizadaEm: string;
  link: string;
}

interface CampoNome {
  name?: string;
  displayName?: string;
}

interface IssueBruta {
  key: string;
  fields?: {
    summary?: string;
    status?: CampoNome;
    issuetype?: CampoNome;
    priority?: CampoNome | null;
    assignee?: CampoNome | null;
    project?: { key?: string; name?: string };
    duedate?: string | null;
    updated?: string;
  };
}

function paraIssue(i: IssueBruta, siteUrl: string): JiraIssue {
  const f = i.fields ?? {};
  return {
    chave: i.key,
    titulo: f.summary?.trim() || "(sem título)",
    status: f.status?.name ?? "?",
    tipo: f.issuetype?.name ?? "?",
    prioridade: f.priority?.name ?? null,
    responsavel: f.assignee?.displayName ?? null,
    projeto: f.project?.name ?? f.project?.key ?? "?",
    vencimento: f.duedate ?? null,
    atualizadaEm: f.updated ?? "",
    // link clicável em vez de só a chave: o dono vai querer abrir
    link: `${siteUrl.replace(/\/$/, "")}/browse/${i.key}`,
  };
}

/** Os campos que as telas e o modelo usam. Pedir só eles deixa a resposta pequena. */
const CAMPOS = "summary,status,issuetype,priority,assignee,project,duedate,updated";

/**
 * Busca issues por JQL.
 *
 * `siteUrl` só serve para montar o link de cada issue; quando não se sabe, o
 * link sai apontando para a chave, que ainda é melhor do que nada.
 */
export async function buscarIssues(token: string, cloudId: string, jql: string, max = 10, siteUrl = "https://jira.atlassian.com"): Promise<JiraIssue[]> {
  const r = await jira<{ issues?: IssueBruta[] }>(
    token,
    cloudId,
    `/search/jql?jql=${encodeURIComponent(jql)}&maxResults=${max}&fields=${CAMPOS}`,
  );
  return (r.issues ?? []).map((i) => paraIssue(i, siteUrl));
}

/** As issues abertas atribuídas a quem conectou. É o "o que eu tenho para fazer no Jira". */
export async function minhasIssues(token: string, cloudId: string, max = 10, siteUrl?: string): Promise<JiraIssue[]> {
  return buscarIssues(token, cloudId, "assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC", max, siteUrl);
}

/**
 * O texto de um comentário ou descrição, no formato de documento do Atlassian.
 *
 * O Jira Cloud v3 recusa string pura nesses campos: quer ADF (Atlassian
 * Document Format). Este é o mínimo que ele aceita, um parágrafo por linha.
 */
function adf(texto: string) {
  const linhas = texto.split("\n").filter((l) => l.trim());
  return {
    type: "doc",
    version: 1,
    content: (linhas.length ? linhas : [texto]).map((linha) => ({
      type: "paragraph",
      content: [{ type: "text", text: linha }],
    })),
  };
}

/** Cria uma issue. Chamar só após confirmação explícita (gate humano, §5.1). */
export async function criarIssue(
  token: string,
  cloudId: string,
  dados: { projeto: string; titulo: string; descricao?: string; tipo?: string },
): Promise<{ chave: string }> {
  const r = await jira<{ key: string }>(token, cloudId, "/issue", {
    method: "POST",
    body: JSON.stringify({
      fields: {
        project: { key: dados.projeto },
        summary: dados.titulo,
        issuetype: { name: dados.tipo ?? "Task" },
        ...(dados.descricao ? { description: adf(dados.descricao) } : {}),
      },
    }),
  });
  return { chave: r.key };
}

/** Comenta numa issue. Chamar só após confirmação explícita. */
export async function comentarIssue(token: string, cloudId: string, chave: string, texto: string): Promise<{ id: string }> {
  const r = await jira<{ id: string }>(token, cloudId, `/issue/${encodeURIComponent(chave)}/comment`, {
    method: "POST",
    body: JSON.stringify({ body: adf(texto) }),
  });
  return { id: r.id };
}

/** As transições de status possíveis a partir do estado atual da issue. */
export async function transicoesDaIssue(token: string, cloudId: string, chave: string): Promise<{ id: string; nome: string }[]> {
  const r = await jira<{ transitions?: { id: string; name?: string; to?: CampoNome }[] }>(
    token,
    cloudId,
    `/issue/${encodeURIComponent(chave)}/transitions`,
  );
  return (r.transitions ?? []).map((t) => ({ id: t.id, nome: t.name ?? t.to?.name ?? t.id }));
}

/**
 * Muda o status de uma issue. Chamar só após confirmação explícita.
 *
 * O Jira não aceita "mude para Concluído": ele aceita o ID de uma TRANSIÇÃO, e
 * quais existem depende do estado atual e do fluxo do projeto. Por isso o nome
 * pedido é casado contra as transições possíveis, e um nome que não existe
 * devolve a lista do que dá para fazer em vez de um erro seco.
 */
export async function mudarStatus(token: string, cloudId: string, chave: string, statusDesejado: string): Promise<{ ok: true } | { erro: string; opcoes: string[] }> {
  const possiveis = await transicoesDaIssue(token, cloudId, chave);
  const alvo = statusDesejado.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const escolhida = possiveis.find((t) => t.nome.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().includes(alvo));
  if (!escolhida) return { erro: `"${statusDesejado}" não é um status possível para ${chave} agora.`, opcoes: possiveis.map((t) => t.nome) };

  await jira<void>(token, cloudId, `/issue/${encodeURIComponent(chave)}/transitions`, {
    method: "POST",
    body: JSON.stringify({ transition: { id: escolhida.id } }),
  });
  return { ok: true };
}
