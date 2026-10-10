import { settings } from "../settings";
import { effectiveRisk, getTool, loadToolOverrides } from "../tools/index";
import { escolherProposta, interpretarResposta } from "../whatsapp/regras";
import { MCP_ACTION_KIND } from "../mcp/pool-rules";
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

export type EstadoDaFrase = "enviado" | "cancelado" | "lista" | "falhou" | "so_na_tela";
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
  const naoPerigosa = (p: { kind: string; payload: unknown }) => {
    // tool MCP não está no registro: o risco dela foi gravado na proposta pelo
    // código que a enfileirou (`mcp/client.ts`), nunca pelo modelo. Proposta
    // MCP antiga, sem risco gravado, só sai pela tela
    if (p.kind === MCP_ACTION_KIND) {
      const risco = (p.payload as { risco?: unknown } | null)?.risco;
      return risco === "efeito_externo";
    }
    const def = getTool(p.kind);
    return def ? effectiveRisk(def, overrides) !== "perigoso" : false;
  };
  // Com NÚMERO ("manda 1") ou "tudo", o dono aponta para a lista que a Órbita
  // acabou de mostrar, e essas propostas são de ANTES da fala anterior dele (a
  // lista veio em resposta a ela). A trava do "desde" é para o "manda" solto,
  // que não pode aprovar uma proposta antiga que ele nem viu.
  const apontou = r.escolha !== undefined || Boolean(r.escolhas?.length) || Boolean(r.todas);
  const doCanal = (await pendentesDoCanal(userId, canal)).filter((p) => apontou || !desde || p.createdAt.getTime() >= desde.getTime());
  const pendentes = doCanal.filter(naoPerigosa);
  if (!pendentes.length) {
    // Só sobrou proposta PERIGOSA: a frase continua sem aprovar nada, mas a
    // resposta agora é dita na hora. Antes ela caía no modelo, que improvisava
    // ("o manda aqui confirma mensagens, não isso") enquanto o dono repetia
    // "manda" e "aprovado" sem entender por que nada saía (05/10/2026).
    if (r.acao === "confirmar" && doCanal.length) {
      return { estado: "so_na_tela", texto: "Essa eu só faço com a sua aprovação na tela, por segurança: está em Atividade, nas ações a confirmar." };
    }
    return null; // frase solta, sem proposta que ela responda: é conversa
  }

  const escolha = escolherProposta(
    pendentes.map((p) => ({ id: p.id, resumo: p.summary, criadaEm: p.createdAt, expiraEm: p.expiraEm })),
    new Date(),
    r.escolha,
    r.escolhas,
    r.todas,
  );
  // só vencidas: a frase não é mais resposta a nada (a proposta continua na tela)
  if (escolha.tipo === "nenhuma") return null;
  if (escolha.tipo === "varias" || escolha.tipo === "fora_da_lista") {
    const lista = escolha.lista.map((p, i) => `${i + 1}. ${p.resumo}`).join("\n");
    return { estado: "lista", texto: `Tenho ${escolha.lista.length} propostas esperando:\n${lista}\n\nResponda *manda 1*, *manda 1 e 2* ou *manda tudo*. Para desistir, *cancela 1* ou *cancela tudo*.` };
  }
  if (escolha.tipo === "escolhidas") return decidirVarias(userId, r.acao, escolha.ids, pendentes);
  if (r.acao === "cancelar") {
    await cancelarAcao(userId, escolha.id);
    return { estado: "cancelado", texto: "Cancelado, não mandei." };
  }
  // "Enviado." só para o que sai de casa; apagar um lançamento respondia
  // "Enviado." e o dono não sabia se tinha apagado
  const kind = pendentes.find((p) => p.id === escolha.id)?.kind ?? "";
  const res = await aprovarAcao(userId, escolha.id);
  if (!res.ok) return { estado: "falhou", texto: `${/^enviar_|^responder_|^mandar_/.test(kind) || !kind ? "Não consegui enviar" : "Não consegui"}: ${res.erro}` };
  if (res.resultado.startsWith("Talvez")) return { estado: "enviado", texto: res.resultado };
  return { estado: "enviado", texto: /^enviar_|^responder_|^mandar_/.test(kind) ? "Enviado." : `Feito: ${mensagemDoResultado(res.resultado)}` };
}

/** "manda 1 e 2", "cancela tudo": decide cada uma e diz o que aconteceu com cada. */
async function decidirVarias(userId: string, acao: "confirmar" | "cancelar", ids: string[], pendentes: { id: string; kind: string; summary: string }[]): Promise<RespostaDaFrase> {
  if (acao === "cancelar") {
    for (const id of ids) await cancelarAcao(userId, id);
    return { estado: "cancelado", texto: ids.length === 1 ? "Cancelado." : `Cancelei as ${ids.length}.` };
  }
  const linhas: string[] = [];
  let falhas = 0;
  for (const id of ids) {
    const p = pendentes.find((x) => x.id === id);
    const res = await aprovarAcao(userId, id);
    if (!res.ok) falhas++;
    linhas.push(`• ${p?.summary ?? "proposta"}: ${res.ok ? mensagemDoResultado(res.resultado) : `não consegui (${res.erro})`}`);
  }
  return { estado: falhas === ids.length ? "falhou" : "enviado", texto: `${falhas ? "Feito em parte" : "Feito"}:\n${linhas.join("\n")}` };
}

/** A frase que a ação devolveu (`{"mensagem": "..."}` ou texto puro), para dizer o que foi feito. Pura. */
export function mensagemDoResultado(resultado: string): string {
  try {
    const o = JSON.parse(resultado) as { mensagem?: unknown };
    if (o && typeof o.mensagem === "string" && o.mensagem.trim()) return o.mensagem.trim();
  } catch {
    /* texto puro */
  }
  return resultado.trim() || "pronto.";
}
