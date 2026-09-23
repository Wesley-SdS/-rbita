/**
 * Quem é a conta que acabou de ser conectada.
 *
 * Existe porque a chave única passou a ser (usuário, provedor, CONTA): sem um
 * identificador estável, conectar a segunda conta do Google substituiria a
 * primeira em silêncio, e o dono só descobriria quando o e-mail do trabalho
 * sumisse da busca.
 *
 * Puro de propósito: cada provedor devolve a identidade num canto diferente da
 * resposta, e errar isso é perder uma conexão sem erro nenhum aparecer.
 */

export interface RespostaDeToken {
  access_token?: string;
  id_token?: string;
  scope?: string;
  authed_user?: { access_token?: string; scope?: string; id?: string };
  team?: { id?: string; name?: string };
  workspace_id?: string;
  workspace_name?: string;
  bot_id?: string;
  owner?: { user?: { id?: string; person?: { email?: string }; name?: string } };
}

export interface IdentidadeDaConta {
  /** identificador estável no provedor; vazio quando ele não informa nenhum */
  externalId: string;
  /** o que aparece na tela: e-mail, nome do workspace, nome da pessoa */
  label: string | null;
}

/**
 * Lê o corpo de um id_token (JWT) SEM verificar assinatura.
 *
 * Não verificar é correto aqui e em nenhum outro lugar: este token veio da
 * resposta direta do endpoint de token do provedor, por TLS, numa chamada que
 * nós fizemos com o nosso client_secret. Não é um token que chegou pelo
 * navegador, então não há o que falsificar. Verificar exigiria buscar e
 * cachear as chaves públicas do provedor sem ganho nenhum de segurança.
 */
export function corpoDoIdToken(idToken: string | undefined): Record<string, unknown> | null {
  if (!idToken) return null;
  const partes = idToken.split(".");
  if (partes.length < 2) return null;
  try {
    const base64 = partes[1]!.replace(/-/g, "+").replace(/_/g, "/");
    const json = Buffer.from(base64, "base64").toString("utf8");
    const obj: unknown = JSON.parse(json);
    return obj && typeof obj === "object" ? (obj as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

const texto = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/**
 * A identidade da conta, por provedor.
 *
 * Quando o provedor não dá identificador nenhum, o externalId sai vazio, e a
 * conexão passa a ser a conta ÚNICA daquele provedor (a chave única cuida
 * disso). É degradação honesta: melhor uma conta só do que duas linhas
 * indistinguíveis na tela.
 */
export function identidadeDaConta(provider: string, tok: RespostaDeToken): IdentidadeDaConta {
  switch (provider) {
    case "google":
    case "microsoft": {
      const corpo = corpoDoIdToken(tok.id_token) ?? {};
      // `sub` é o id imutável; o e-mail muda de dono e não serve de chave
      const externalId = texto(corpo.sub) ?? texto(corpo.oid) ?? "";
      const label = texto(corpo.email) ?? texto(corpo.preferred_username) ?? texto(corpo.name);
      return { externalId, label };
    }
    case "slack":
      return { externalId: texto(tok.team?.id) ?? "", label: texto(tok.team?.name) };
    case "notion":
      return {
        externalId: texto(tok.workspace_id) ?? "",
        label: texto(tok.workspace_name) ?? texto(tok.owner?.user?.name),
      };
    default:
      return { externalId: "", label: texto(tok.workspace_name) ?? texto(tok.team?.name) };
  }
}

/**
 * Como a conta aparece quando o provedor não mandou rótulo.
 *
 * "Conta 2" é ruim, mas é melhor do que duas linhas idênticas na tela: o dono
 * precisa conseguir dizer qual ele quer desconectar.
 */
export function rotuloDeExibicao(label: string | null, posicao: number): string {
  return label ?? (posicao <= 1 ? "Conta conectada" : `Conta ${posicao}`);
}
