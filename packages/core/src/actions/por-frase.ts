import { settings } from "../settings";
import { escolherProposta, interpretarResposta } from "../whatsapp/regras";
import { aprovarAcao, cancelarAcao, pendentesDoCanal } from "./aprovar";

/**
 * Aprovar FALANDO (PRD-WHATSAPP W6): o dono diz "manda" na conversa "Eu" do
 * WhatsApp ou na conversa por voz, e a proposta daquele canal sai.
 *
 * Quem decide é o CÓDIGO, lendo a frase do DONO; o modelo nem participa. Quem
 * chama aqui garante que o texto é fala do dono: a mensagem dele no próprio
 * chat (WhatsApp) ou a transcrição da fala DELE na sessão de voz, nunca o que
 * o modelo gerou nem o que um terceiro escreveu.
 *
 * Devolve o que dizer ao dono, ou nulo se a frase não era resposta a proposta
 * (e aí ela segue como pedido normal).
 */
export async function aprovarPorFrase(userId: string, canal: "whatsapp" | "voz", texto: string): Promise<string | null> {
  const cfg = await settings.getMany(["whatsapp.frasesConfirmar", "whatsapp.frasesCancelar"]);
  const r = interpretarResposta(texto, cfg["whatsapp.frasesConfirmar"], cfg["whatsapp.frasesCancelar"]);
  if (!r.acao) return null;
  const pendentes = await pendentesDoCanal(userId, canal);
  if (!pendentes.length) return null; // "sim" solto, sem proposta: é conversa, não aprovação
  const escolha = escolherProposta(
    pendentes.map((p) => ({ id: p.id, resumo: p.summary, criadaEm: p.createdAt, expiraEm: p.expiraEm })),
    new Date(),
    r.escolha,
  );
  // só vencidas: a frase não é mais resposta a nada (a proposta continua na
  // tela). Responder "venceu" aqui transformaria todo "sim" da conversa, para
  // sempre, num aviso sobre uma proposta esquecida.
  if (escolha.tipo === "nenhuma") return null;
  if (escolha.tipo === "varias" || escolha.tipo === "fora_da_lista") {
    const lista = escolha.lista.map((p, i) => `${i + 1}. ${p.resumo}`).join("\n");
    return `Tenho ${escolha.lista.length} propostas esperando:\n${lista}\n\nDiga "manda 1", "manda 2"… ou "cancela 1".`;
  }
  if (r.acao === "cancelar") {
    await cancelarAcao(userId, escolha.id);
    return "Cancelado, não mandei.";
  }
  const res = await aprovarAcao(userId, escolha.id);
  return res.ok ? "Enviado." : `Não consegui enviar: ${res.erro}`;
}
