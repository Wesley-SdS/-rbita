/**
 * O aviso do que chegou no trabalho, em gente. Puro.
 *
 * Um aviso por volta, não um por evento: três comentários na mesma PR em dois
 * minutos são UMA notícia ("o Caio comentou 3 vezes na PR do login"), e o
 * WhatsApp do dono não pode virar log de CI. Sem travessão (§6).
 */

export interface NovidadeParaAviso {
  provedor: "github" | "slack";
  tipo: string;
  /** "org/repo#42: Título" ou "#canal" / "mensagem direta" */
  contexto: string;
  autor: string;
  estado: string | null;
  trecho: string;
  conta: string;
}

const MAX_LINHAS = 8;

/** "org/repo#42: Corrige o login" → "a PR #42 (Corrige o login)". */
function nomeDaPr(contexto: string): string {
  const m = /^[^#]+#(\d+):\s*(.+)$/.exec(contexto);
  return m ? `a PR #${m[1]} (${m[2]!.slice(0, 60)})` : contexto;
}

function frase(grupo: NovidadeParaAviso[]): string {
  const n = grupo[0]!;
  const quem = n.autor || "Alguém";
  if (n.provedor === "github") {
    if (n.tipo === "pedido_review") return `${quem} pediu o seu review em ${nomeDaPr(n.contexto)}.`;
    const mudancas = grupo.find((g) => g.estado === "CHANGES_REQUESTED");
    if (mudancas) return `${mudancas.autor} pediu mudanças em ${nomeDaPr(n.contexto)}.`;
    const aprovou = grupo.find((g) => g.estado === "APPROVED");
    if (aprovou && grupo.length === 1) return `${aprovou.autor} aprovou ${nomeDaPr(n.contexto)}.`;
    const autores = [...new Set(grupo.map((g) => g.autor))];
    return grupo.length === 1
      ? `${quem} comentou em ${nomeDaPr(n.contexto)}: "${n.trecho.replace(/\s+/g, " ").slice(0, 120)}"`
      : `${autores.join(" e ")} ${autores.length > 1 ? "comentaram" : "comentou"} ${grupo.length} vezes em ${nomeDaPr(n.contexto)}.`;
  }
  const onde = n.tipo === "mensagem_direta" ? "te mandou mensagem" : `te mencionou em ${n.contexto}`;
  return grupo.length === 1 ? `${quem} ${onde}: "${n.trecho.replace(/\s+/g, " ").slice(0, 120)}"` : `${quem} ${onde} (${grupo.length} mensagens).`;
}

export function textoDoAvisoDeTrabalho(novas: NovidadeParaAviso[]): { titulo: string; corpo: string } {
  // agrupa pelo assunto: a mesma PR (ou o mesmo canal e pessoa) é uma linha só
  const grupos = new Map<string, NovidadeParaAviso[]>();
  for (const n of novas) {
    const chave = n.provedor === "github" ? `gh|${n.tipo === "pedido_review" ? "pedido" : "pr"}|${n.contexto}` : `sl|${n.tipo}|${n.contexto}|${n.autor}`;
    grupos.set(chave, [...(grupos.get(chave) ?? []), n]);
  }
  const lista = [...grupos.values()];
  const github = lista.filter((g) => g[0]!.provedor === "github").map(frase);
  const slack = lista.filter((g) => g[0]!.provedor === "slack").map(frase);
  const partes: string[] = [];
  if (github.length) partes.push(`*No GitHub*\n${github.slice(0, MAX_LINHAS).join("\n")}`);
  if (slack.length) partes.push(`*No Slack*\n${slack.slice(0, MAX_LINHAS).join("\n")}`);
  const resto = Math.max(0, github.length - MAX_LINHAS) + Math.max(0, slack.length - MAX_LINHAS);
  if (resto) partes.push(`E mais ${resto} na tela inicial.`);

  const temMudanca = novas.some((n) => n.estado === "CHANGES_REQUESTED");
  const titulo = temMudanca ? "Pediram mudanças numa PR sua" : lista.length === 1 ? "Chegou algo para você no trabalho" : `${lista.length} novidades no seu trabalho`;
  // título de PR e mensagem vêm de fora com travessão; no aviso, vírgula (§6)
  return { titulo, corpo: partes.join("\n\n").replace(/\s*[—–]\s*/g, ", ") };
}
