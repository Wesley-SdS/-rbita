/** Tipos compartilhados do console (chat/voz/conversas). */
export type Role = "user" | "assistant";
export interface ToolStep { name: string; done: boolean }
/** Uma saída oferecida quando o provedor escolhido não pôde atender. */
export interface OpcaoDeProvedor { classe: "assinatura" | "local" | "paga"; rotulo: string; custo: string }
/**
 * A pergunta que a Órbita faz em vez de trocar de provedor sozinha. Fica NA
 * MENSAGEM (e não num estado solto) para sobreviver ao histórico: a pessoa
 * pode rolar a conversa, voltar e a escolha ainda estar lá.
 */
export interface PerguntaDeProvedor { motivo: string; opcoes: OpcaoDeProvedor[]; pergunta: string }
/** "Preciso ver para responder": o pedido fica na mensagem, com o botão. */
export interface PedidoDeCamera { motivo: string; pergunta: string; cameraId: string | null }
export interface Msg { role: Role; content: string; steps?: ToolStep[]; image?: string; escolha?: PerguntaDeProvedor; pedidoCamera?: PedidoDeCamera }
export interface ModelInfo {
  key: string;
  label: string;
  provider: string;
  billing: "free" | "subscription" | "paid" | "variable";
}

/**
 * Ponte chat ↔ voz. O chat chama a voz por esta interface (via ref atualizada a
 * cada render), o que quebra o ciclo `sendMessage`↔`voiceCommand` e evita
 * stale-closure nos callbacks assíncronos (wake word/TTS).
 */
export type VoiceBridge = {
  /** Fala a resposta e re-arma a escuta; retorna true se a voz assumiu o pós-resposta. */
  handleAssistantResponse: (text: string) => boolean;
  /** Interrompe a fala imediatamente (barge-in / botão parar). */
  stopSpeaking: () => void;
};

/**
 * Estado do núcleo durante um turno. Vivia em `components/orb.tsx`, junto do
 * núcleo antigo; virou tipo compartilhado quando aquele componente saiu, porque
 * quem depende dele é o caminho do chat e da voz, não o desenho.
 *
 * O núcleo do Presença tem dez estados; estes seis são os que o chat produz
 * hoje. `components/presenca/conversa.tsx` faz a tradução.
 */
export type OrbMode = "standby" | "listening" | "speaking" | "searching" | "studying" | "connecting";
