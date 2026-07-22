/**
 * Registry de conectores OAuth2. Cada conector é declarado aqui e só aparece
 * "disponível" quando suas credenciais (env) estão presentes — exatamente o
 * padrão já usado pela camada de LLM (providerEnv) e pelo login social.
 *
 * Nenhuma credencial é embutida: o Wesley pluga GOOGLE_CLIENT_ID/SECRET, etc.
 * e o conector acende sozinho, sem mudança de código.
 */

export type ConnectorId = "google" | "notion" | "slack";

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
}

const G_ID = process.env.GOOGLE_CLIENT_ID;
const G_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const N_ID = process.env.NOTION_CLIENT_ID;
const N_SECRET = process.env.NOTION_CLIENT_SECRET;
const S_ID = process.env.SLACK_CLIENT_ID;
const S_SECRET = process.env.SLACK_CLIENT_SECRET;

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
    authorizeParams: { access_type: "offline", prompt: "consent" },
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
