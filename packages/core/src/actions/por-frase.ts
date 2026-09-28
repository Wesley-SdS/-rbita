import { settings } from "../settings";
import { effectiveRisk, getTool, loadToolOverrides } from "../tools/index";
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
 * Três travas além da frase:
 *   - só proposta do MESMO canal;
 *   - só proposta nascida DEPOIS da fala anterior do dono (\`desde\`): "manda" é
 *     resposta ao que acabou de ser proposto, não a qualquer coisa pendente da
 *     última meia hora. Sem isso, um "sim" dito para outra pergunta enviava;
 *   - NUNCA risco \`perigoso\` (fechadura, portão, alarme): fala não libera ação
 *     perigosa (decisão 9.5). Essa só sai pela tela.
 */

export type EstadoDaFrase = "enviado" | "cancelado" | "lista" | "falhou";
export interface RespostaDaFrase {
  estado: EstadoDaFrase;
  /** o que dizer ao dono (pode conter o resumo das propostas) */
  texto: string;
}

export async function aprovarPorFrase(userId: string, canal: "whatsapp" | "voz" | "telegram", fala: string, desde?: Date | null): Promise<RespostaDaFrase | null> {
  const cfg = await settings.getMany(["whatsapp.frasesConfirmar", "whatsapp.frasesCancelar"]);
  const r = interpretarResposta(fala, cfg["whatsapp.frasesConfirmar"], cfg["whatsapp.frasesCancelar"]);
  if (!r.acao) return null;

  const overrides = await loadToolOverrides();
  const naoPerigosa = (kind: string) => {
    const def = getTool(kind);
    return def ? effectiveRisk(def, overrides) !== "perigoso" : false;
  };
  const pendentes = (await pendentesDoCanal(userId, canal)).filter((p) => naoPerigosa(p.kind) && (!desde || p.createdAt.getTime() >= desde.getTime()));
  if (!pendentes.length) return null; // frase solta, sem proposta que ela responda: é conversa

  const escolha = escolherProposta(
    pendentes.map((p) => ({ id: p.id, resumo: p.summary, criadaEm: p.createdAt, expiraEm: p.expiraEm })),
    new Date(),
    r.escolha,
  );
  // só vencidas: a frase não é mais resposta a nada (a proposta continua na tela)
  if (escolha.tipo === "nenhuma") return null;
  if (escolha.tipo === "varias" || escolha.tipo === "fora_da_lista") {
    const lista = escolha.lista.map((p, i) => `${i + 1}. ${p.resumo}`).join("\n");
    return { estado: "lista", texto: `Tenho ${escolha.lista.length} propostas esperando:\n${lista}\n\nDiga "manda 1", "manda 2"… ou "cancela 1".` };
  }
  if (r.acao === "cancelar") {
    await cancelarAcao(userId, escolha.id);
    return { estado: "cancelado", texto: "Cancelado, não mandei." };
  }
  const res = await aprovarAcao(userId, escolha.id);
  return res.ok ? { estado: "enviado", texto: res.resultado.startsWith("Talvez") ? res.resultado : "Enviado." } : { estado: "falhou", texto: `Não consegui enviar: ${res.erro}` };
}
