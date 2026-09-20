/**
 * As telas do Presença, em um lugar só.
 *
 * Menu lateral, breadcrumb, título da aba e a busca do ⌘K leem daqui. Manter
 * uma lista só evita o que sempre acontece quando são três: a tela nova entra
 * no menu e some do breadcrumb.
 */

export interface Tela {
  slug: string;
  href: string;
  titulo: string;
  icone: string;
  grupo: "espaco" | "conectado" | "rodape";
}

export const TELAS: Tela[] = [
  { slug: "inicio", href: "/app", titulo: "Visão geral", icone: "orbit", grupo: "espaco" },
  { slug: "conversa", href: "/app/conversa", titulo: "Conversas", icone: "chat", grupo: "espaco" },
  { slug: "memoria", href: "/app/memoria", titulo: "Memória", icone: "network", grupo: "espaco" },
  { slug: "rotinas", href: "/app/rotinas", titulo: "Rotinas", icone: "flow", grupo: "espaco" },
  { slug: "casa", href: "/app/casa", titulo: "Minha casa", icone: "home", grupo: "conectado" },
  { slug: "reunioes", href: "/app/reunioes", titulo: "Reuniões", icone: "wave", grupo: "conectado" },
  { slug: "financas", href: "/app/financas", titulo: "Finanças", icone: "wallet", grupo: "conectado" },
  { slug: "conexoes", href: "/app/conexoes", titulo: "Conexões", icone: "plug", grupo: "conectado" },
  { slug: "ajustes", href: "/app/ajustes", titulo: "Preferências", icone: "settings", grupo: "rodape" },
];

/**
 * Qual tela um caminho representa.
 *
 * Compara do mais específico para o menos específico porque `/app` é prefixo de
 * todas as outras: casar na ordem da lista deixaria `/app/casa` marcado como
 * "Visão geral".
 */
export function telaDoCaminho(caminho: string): Tela {
  const inicio = TELAS[0]!;
  const encontrada = [...TELAS]
    .sort((a, b) => b.href.length - a.href.length)
    .find((t) => caminho === t.href || caminho.startsWith(`${t.href}/`));
  return encontrada ?? inicio;
}
