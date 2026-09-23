/**
 * Registry de conectores OAuth2. Cada conector é declarado aqui e só aparece
 * "disponível" quando suas credenciais (env) estão presentes — exatamente o
 * padrão já usado pela camada de LLM (providerEnv) e pelo login social.
 *
 * Nenhuma credencial é embutida: o Wesley pluga GOOGLE_CLIENT_ID/SECRET, etc.
 * e o conector acende sozinho, sem mudança de código.
 */

export type ConnectorId = "google" | "notion" | "slack" | "microsoft" | "jira";

export interface ConnectorDef {
  id: ConnectorId;
  label: string;
  /** Emoji/ícone para a UI. */
  icon: string;
  /** O que este conector habilita (aparece na UI). */
  blurb: string;
  authorizeUrl: string;
  tokenUrl: string;
  scopes: string[];
  /** Extra params no authorize (ex.: access_type=offline p/ refresh do Google). */
  authorizeParams?: Record<string, string>;
  clientId?: string;
  clientSecret?: string;
  /**
   * O endpoint de token quer JSON, não `application/x-www-form-urlencoded`.
   * O Atlassian é assim; mandar form devolve 400 sem dizer o porquê.
   */
  tokenAsJson?: boolean;
  /**
   * Descobre QUAL conta é esta com uma segunda chamada, para provedores que
   * não devolvem id_token nem id de workspace no retorno do token.
   *
   * No Atlassian a identidade é o `cloudid` do site, e ele só aparece em
   * `/oauth/token/accessible-resources`. Sem isso não haveria como ter dois
   * workspaces de Jira, e pior: não haveria como montar a URL da API, que
   * inclui o cloudid.
   */
  descobrirConta?: (accessToken: string) => Promise<{ externalId: string; label: string | null }>;
}

const G_ID = process.env.GOOGLE_CLIENT_ID;
const G_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const N_ID = process.env.NOTION_CLIENT_ID;
const N_SECRET = process.env.NOTION_CLIENT_SECRET;
const S_ID = process.env.SLACK_CLIENT_ID;
const S_SECRET = process.env.SLACK_CLIENT_SECRET;
const M_ID = process.env.MICROSOFT_CLIENT_ID;
const M_SECRET = process.env.MICROSOFT_CLIENT_SECRET;
const J_ID = process.env.ATLASSIAN_CLIENT_ID ?? process.env.JIRA_CLIENT_ID;
const J_SECRET = process.env.ATLASSIAN_CLIENT_SECRET ?? process.env.JIRA_CLIENT_SECRET;

const DEFS: Record<ConnectorId, ConnectorDef> = {
  google: {
    id: "google",
    label: "Google (Gmail + Agenda)",
    icon: "✉️",
    blurb: "Ler e rascunhar e-mails, ver e criar eventos na agenda.",
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: [
      // ACESSO TOTAL (pedido do Wesley). Enquanto o app não for verificado pelo
      // Google, ele fica em modo "teste": funciona 100% para os test users, com
      // a tela de "app não verificado" que se aceita manualmente.
      "https://mail.google.com/", // Gmail completo: ler, enviar, rascunhar, gerenciar, apagar
      "https://www.googleapis.com/auth/calendar", // Agenda completa (todos os calendários)
      "https://www.googleapis.com/auth/contacts", // Contatos (resolver "e-mail pro João")
      "https://www.googleapis.com/auth/tasks", // Tarefas do Google
      "openid",
      "email",
    ],
    // `select_account` junto do `consent`: sem ele o Google reusa a conta já
    // logada no navegador e a SEGUNDA conta nunca chega a ser oferecida. O
    // dono clicava em "conectar outra" e reconectava a mesma.
    authorizeParams: { access_type: "offline", prompt: "consent select_account" },
    clientId: G_ID,
    clientSecret: G_SECRET,
  },
  notion: {
    id: "notion",
    label: "Notion",
    icon: "📓",
    blurb: "Buscar e ler páginas do seu workspace do Notion.",
    authorizeUrl: "https://api.notion.com/v1/oauth/authorize",
    tokenUrl: "https://api.notion.com/v1/oauth/token",
    scopes: [],
    authorizeParams: { owner: "user" },
    clientId: N_ID,
    clientSecret: N_SECRET,
  },
  slack: {
    id: "slack",
    label: "Slack",
    icon: "💬",
    blurb: "Enviar mensagens e ler canais do seu workspace.",
    authorizeUrl: "https://slack.com/oauth/v2/authorize",
    tokenUrl: "https://slack.com/api/oauth.v2.access",
    // escopos de usuário: postar como você e ler histórico.
    scopes: ["chat:write", "channels:read", "channels:history"],
    clientId: S_ID,
    clientSecret: S_SECRET,
  },
  microsoft: {
    id: "microsoft",
    label: "Microsoft (Outlook + Teams)",
    icon: "🟦",
    blurb: "E-mail e agenda do Outlook, mais chats e canais do Teams.",
    authorizeUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    // mesma razão do Google: sem `select_account` a segunda conta não aparece
    authorizeParams: { prompt: "select_account" },
    // Teams (chat e canal) MAIS Outlook (e-mail e agenda). O comentário antigo
    // dizia que Mail/Calendar ficavam de fora "porque o Google já faz": isso
    // valia quando havia uma conta só. Com o Outlook do trabalho ao lado do
    // Gmail pessoal, a Órbita precisa ler as duas caixas para responder "tenho
    // algum e-mail importante?" sem mentir. Continua sem acesso amplo ao
    // diretório da organização.
    scopes: [
      "offline_access",
      "openid",
      "email",
      "profile",
      "Mail.ReadWrite",
      "Mail.Send",
      "Calendars.ReadWrite",
      "Chat.ReadWrite",
      "ChannelMessage.Send",
      "Team.ReadBasic.All",
      "Channel.ReadBasic.All",
    ],
    clientId: M_ID,
    clientSecret: M_SECRET,
  },
  jira: {
    id: "jira",
    label: "Jira (Atlassian)",
    icon: "🧩",
    blurb: "Ver suas issues, criar tarefas, comentar e mudar status.",
    authorizeUrl: "https://auth.atlassian.com/authorize",
    tokenUrl: "https://auth.atlassian.com/oauth/token",
    scopes: ["read:jira-work", "write:jira-work", "read:jira-user", "offline_access"],
    // `audience` é obrigatório no 3LO do Atlassian, e `prompt=consent` é o que
    // faz o refresh_token vir (sem ele a conexão morre em uma hora).
    authorizeParams: { audience: "api.atlassian.com", prompt: "consent" },
    tokenAsJson: true,
    descobrirConta: async (accessToken: string) => {
      const res = await fetch("https://api.atlassian.com/oauth/token/accessible-resources", {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
      });
      if (!res.ok) return { externalId: "", label: null };
      const sites = (await res.json()) as { id?: string; name?: string; url?: string }[];
      // o primeiro site autorizado: o consentimento do Atlassian é POR SITE,
      // então conectar outro workspace é outra passagem pelo OAuth, que vira
      // outra linha na tabela (é exatamente o que a multi-conta espera)
      const site = Array.isArray(sites) ? sites[0] : undefined;
      return { externalId: site?.id ?? "", label: site?.name ?? site?.url ?? null };
    },
    clientId: J_ID,
    clientSecret: J_SECRET,
  },
};

export const CONNECTOR_IDS = Object.keys(DEFS) as ConnectorId[];

export function getConnector(id: string): ConnectorDef | undefined {
  return DEFS[id as ConnectorId];
}

/** Um conector está "configurado" quando tem clientId + clientSecret no ambiente. */
export function isConfigured(id: ConnectorId): boolean {
  const d = DEFS[id];
  return Boolean(d?.clientId && d?.clientSecret);
}

/** URL de callback pública deste conector. */
export function redirectUri(id: ConnectorId): string {
  const base = process.env.BETTER_AUTH_URL ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/api/connectors/${id}/callback`;
}

/** Lista para a UI: cada conector com flag de configurado. */
export function listConnectors() {
  return CONNECTOR_IDS.map((id) => {
    const d = DEFS[id];
    return { id: d.id, label: d.label, icon: d.icon, blurb: d.blurb, configured: isConfigured(id) };
  });
}
