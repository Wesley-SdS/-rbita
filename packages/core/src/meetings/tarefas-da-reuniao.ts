import type { Compromisso } from "./compromissos";
import { parsePrazo } from "./compromissos";
import type { NovaTarefa } from "../tarefas/store";
import { criarTarefa } from "../tarefas/store";
import { settings } from "../settings";
import { log } from "../observability/logger";

/**
 * O QUE FICOU PARA VOCÊ FAZER DEPOIS DA REUNIÃO.
 *
 * Os compromissos já eram extraídos, e paravam dentro do texto do resumo. Quem
 * lesse o resumo via; quem não lesse, esquecia. O dono pediu o contrário:
 * o que ele ficou de fazer tem de aparecer nas tarefas dele, **com o vínculo
 * de volta à reunião**, para responder "por que eu fiquei de fazer isso, e
 * para quem?" duas semanas depois.
 *
 * A parte que decide QUAIS viram tarefa é pura e tem teste: errar para mais
 * enche a lista de tarefa de outra pessoa, e errar para menos perde o
 * compromisso, que é o problema que isto veio resolver.
 */

export type QuemCria = "minhas" | "todas" | "nenhuma";

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/**
 * O compromisso é meu?
 *
 * Sem responsável declarado conta como meu: quem gravou a reunião é o dono, e
 * "vou mandar o relatório" dito por ele raramente vem com o nome junto. É a
 * regra que acerta na maioria e, quando erra, erra para o lado de lembrar
 * demais, que é recuperável com um clique.
 *
 * "Locutor A" e afins NÃO contam como meu: são rótulo de diarização, não
 * nome, e tratá-los como o dono encheria a lista com o que os outros
 * combinaram.
 */
export function ehMeu(responsavel: string | undefined, meuNome: string): boolean {
  const r = semAcento(responsavel ?? "");
  if (!r) return true;
  if (/^locutor\b|^speaker\b|^participante\b/.test(r)) return false;
  const eu = semAcento(meuNome);
  if (!eu) return false;
  // primeiro nome basta: a transcrição raramente traz o nome completo
  return r.includes(eu) || eu.includes(r);
}

/**
 * Quais compromissos viram tarefa, e com que cara.
 *
 * O `origemTrecho` guarda o compromisso COMO FOI DITO, não a tarefa reescrita:
 * é ele que responde "por quê" quando o título, sozinho, não diz mais nada.
 */
export function tarefasDeCompromissos(
  compromissos: Compromisso[],
  opcoes: { quem: QuemCria; meuNome: string; reuniaoId: string | null; reuniaoTitulo: string; agora?: Date },
): NovaTarefa[] {
  if (opcoes.quem === "nenhuma") return [];

  const out: NovaTarefa[] = [];
  for (const c of compromissos) {
    const descricao = c.descricao.trim();
    if (!descricao) continue;
    if (opcoes.quem === "minhas" && !ehMeu(c.responsavel, opcoes.meuNome)) continue;

    // prazo só vira data quando é explícito; `parsePrazo` já recusa "amanhã"
    // e afins, porque tarefa com data errada é pior do que tarefa sem data
    const prazo = parsePrazo(c.prazo, opcoes.agora);
    out.push({
      texto: descricao,
      vencimento: prazo ? prazo.toISOString() : null,
      paraQuem: c.responsavel?.trim() || null,
      origem: {
        tipo: "reuniao",
        id: opcoes.reuniaoId,
        titulo: opcoes.reuniaoTitulo,
        trecho: descricao,
      },
    });
  }
  return out;
}

/**
 * Cria as tarefas da reunião. Fail-soft por natureza: o resumo já ficou pronto
 * e não pode ser perdido porque uma tarefa não entrou.
 */
export async function criarTarefasDaReuniao(
  userId: string,
  compromissos: Compromisso[],
  reuniao: { id: string | null; titulo: string },
): Promise<number> {
  const cfg = await settings.getMany(["meetings.criarTarefas", "meetings.meuNome"]);
  const novas = tarefasDeCompromissos(compromissos, {
    quem: cfg["meetings.criarTarefas"] as QuemCria,
    meuNome: cfg["meetings.meuNome"],
    reuniaoId: reuniao.id,
    reuniaoTitulo: reuniao.titulo,
  });

  let criadas = 0;
  for (const t of novas) {
    try {
      await criarTarefa(userId, t);
      criadas++;
    } catch (e) {
      log.warn("reuniao.tarefa_nao_criada", { userId, error: e instanceof Error ? e.message : String(e) });
    }
  }
  if (criadas) log.info("reuniao.tarefas_criadas", { userId, criadas, de: compromissos.length });
  return criadas;
}
