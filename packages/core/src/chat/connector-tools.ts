/**
 * As tools de conector (Gmail, Agenda, Notion, Slack, WhatsApp) migraram para
 * packages/core/src/tools/domains/{google,notion,slack,whatsapp}.ts, com risco
 * declarado e gate derivado pelo registro (CLAUDE.md §5.7). Este módulo fica só
 * para quem ainda importar o nome antigo.
 */
export { buildToolSet as buildConnectorTools } from "../tools/index";
