import { webRoute } from "../http/web-route";
import * as todos from "./todos";
import * as conversations from "./conversations";
import * as conversationsById from "./conversations-by-id";
import * as chat from "./chat";
import * as tts from "./tts";
import * as memory from "./memory";
import * as notifications from "./notifications";
import * as routines from "./routines";
import * as routinesRun from "./routines-run";
import * as profile from "./profile";
import * as skills from "./skills";
import * as widgets from "./widgets";
import * as widgetsData from "./widgets-data";
import * as usage from "./usage";
import * as analytics from "./analytics";
import * as account from "./account";
import * as accountExport from "./account-export";
import * as accountReindex from "./account-reindex";
import * as knowledge from "./knowledge";
import * as knowledgeGraph from "./knowledge-graph";
import * as models from "./models";
import * as connectors from "./connectors";
import * as connectorsProvider from "./connectors-provider";
import * as connectorsProviderConnect from "./connectors-provider-connect";
import * as mcp from "./mcp";
import * as actions from "./actions";
import * as pushSubscribe from "./push-subscribe";
import * as pushTest from "./push-test";
import * as health from "./health";
import * as voiceConfig from "./voice-config";
import * as realtimeConfig from "./realtime-config";
import * as realtimeSession from "./realtime-session";
import * as realtimeTool from "./realtime-tool";
import * as vision from "./vision";
import * as meetingSummarize from "./meeting-summarize";
import * as meetingSpeakers from "./meeting-speakers";
import * as homeConnection from "./home-connection";
import * as homeRooms from "./home-rooms";
import * as homeEntities from "./home-entities";
import * as homeDomainRisk from "./home-domain-risk";
import * as homePersons from "./home-persons";
import * as homePersonAccess from "./home-person-access";
import * as identityConsent from "./identity-consent";
import * as identityBiometrics from "./identity-biometrics";
import * as identityVisibility from "./identity-visibility";
import * as identityAudit from "./identity-audit";
import * as identityVoice from "./identity-voice";
import * as identityFace from "./identity-face";
import * as identityPresence from "./identity-presence";
import * as identityLimits from "./identity-limits";
import * as devices from "./devices";
import * as channelsWhatsapp from "./channels-whatsapp";
import * as cameras from "./cameras";
import * as cameraEvents from "./camera-events";
import * as cameraIngest from "./camera-ingest";
import * as ingest from "./ingest";
import * as finance from "./finance";
import * as financeReceipt from "./finance-receipt";
import * as financeStatement from "./finance-statement";
import * as upload from "./upload";
import * as stt from "./stt";

/**
 * Rotas migradas do Next em paridade (NST.2). Cada linha = um caminho que
 * saiu de apps/web/src/app/api e entrou em API_IN_NEST (next.config.ts).
 * Caminhos com parâmetro usam a sintaxe do Express (`:id`). Rotas mais
 * específicas vêm antes das genéricas com parâmetro (connect antes de :provider).
 *
 * Ficam no Next, de propósito: /api/auth/* (Better Auth) e
 * /api/connectors/:provider/callback (o redirect do OAuth volta para o Next).
 */
export const ROUTE_CONTROLLERS = [
  // as duas "não mecânicas": streaming NDJSON com failover, e cadeia de TTS com AbortSignal
  webRoute("api/chat", chat),
  webRoute("api/tts", tts),
  // chat e conhecimento
  webRoute("api/conversations", conversations),
  webRoute("api/conversations/:id", conversationsById),
  webRoute("api/memory", memory),
  webRoute("api/knowledge", knowledge),
  webRoute("api/knowledge/graph", knowledgeGraph),
  webRoute("api/ingest", ingest),
  webRoute("api/meeting/summarize", meetingSummarize),
  webRoute("api/meeting/:id/speakers", meetingSpeakers),
  webRoute("api/home/connection", homeConnection),
  webRoute("api/home/rooms", homeRooms),
  webRoute("api/home/entities", homeEntities),
  webRoute("api/home/domain-risk", homeDomainRisk),
  webRoute("api/home/persons", homePersons),
  webRoute("api/home/person-access", homePersonAccess),
  // identidade (Fase 2): consentimento, biometria, permissão sobre pessoas, auditoria
  webRoute("api/identity/consent", identityConsent),
  webRoute("api/identity/biometrics", identityBiometrics),
  webRoute("api/identity/visibility", identityVisibility),
  webRoute("api/identity/audit", identityAudit),
  webRoute("api/identity/voice", identityVoice),
  webRoute("api/identity/face", identityFace),
  webRoute("api/identity/presence", identityPresence),
  webRoute("api/identity/limits", identityLimits),
  webRoute("api/devices", devices),
  webRoute("api/channels/whatsapp", channelsWhatsapp),
  webRoute("api/cameras", cameras),
  webRoute("api/cameras/events", cameraEvents),
  webRoute("api/cameras/ingest", cameraIngest),
  webRoute("api/vision", vision),
  webRoute("api/models", models),
  // dia a dia
  webRoute("api/todos", todos),
  webRoute("api/finance", finance),
  webRoute("api/finance/receipt", financeReceipt),
  webRoute("api/finance/statement", financeStatement),
  webRoute("api/upload", upload),
  webRoute("api/stt", stt),
  webRoute("api/widgets", widgets),
  webRoute("api/widgets/data", widgetsData),
  webRoute("api/profile", profile),
  webRoute("api/skills", skills),
  webRoute("api/mcp", mcp),
  // proatividade e ações
  webRoute("api/routines", routines),
  webRoute("api/routines/run", routinesRun),
  webRoute("api/notifications", notifications),
  webRoute("api/actions", actions),
  webRoute("api/push/subscribe", pushSubscribe),
  webRoute("api/push/test", pushTest),
  // conectores (o callback fica no Next)
  webRoute("api/connectors", connectors),
  webRoute("api/connectors/:provider/connect", connectorsProviderConnect),
  webRoute("api/connectors/:provider", connectorsProvider),
  // conta, uso e voz
  webRoute("api/account", account),
  webRoute("api/account/export", accountExport),
  webRoute("api/account/reindex", accountReindex),
  webRoute("api/usage", usage),
  webRoute("api/analytics", analytics),
  webRoute("api/voice-config", voiceConfig),
  webRoute("api/realtime/config", realtimeConfig),
  webRoute("api/realtime/session", realtimeSession),
  webRoute("api/realtime/tool", realtimeTool),
  webRoute("api/health", health),
];
