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
/**
 * A PROPOSTA ESPERANDO APROVAÇÃO, na própria conversa.
 *
 * O gate humano (§5.1) mandava a pessoa para o painel "Ações a confirmar": a
 * Órbita dizia "não consigo aprovar por você, abra o painel" e a conversa
 * morria ali. O dono pediu "um wizard mostrando como ficou, eu podendo alterar
 * e confirmar". O `payload` vem junto porque é ele que se edita; a execução
 * continua acontecendo só no POST /api/actions.
 */
export interface PropostaPendente {
  id: string;
  kind: string;
  resumo: string;
  payload: Record<string, unknown>;
  /** o que aconteceu depois de decidir, para o cartão parar de pedir ação */
  estado?: "confirmada" | "descartada";
  resultado?: string;
}
export interface Msg {
  role: Role;
  content: string;
  steps?: ToolStep[];
  image?: string;
  escolha?: PerguntaDeProvedor;
  pedidoCamera?: PedidoDeCamera;
  proposta?: PropostaPendente;
  /** o quadro que a Órbita olhou para responder: quem autorizou o olhar vê o que ela viu */
  olhou?: string;
}
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
import type { FluxoDeFala } from "@/lib/voice/engine";

export type VoiceBridge = {
  /** Fala a resposta e re-arma a escuta; retorna true se a voz assumiu o pós-resposta. */
  handleAssistantResponse: (text: string) => boolean;
  /**
   * Abre uma fala que ACOMPANHA o texto chegando. `null` quando a voz está
   * desligada ou o TTS do servidor está falhando: aí o chamador cai no
   * `handleAssistantResponse` do fim, como antes.
   */
  iniciarFalaEmFluxo: () => FluxoDeFala | null;
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
