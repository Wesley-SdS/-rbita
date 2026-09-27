/**
 * Palpite de categoria (PRD §8.3). Usado em três lugares que precisam do MESMO
 * palpite: ditado (`ditado.ts`), leitura de boleto (`boleto.ts`) e importação
 * de extrato (`extrato.ts`). Por isso mora sozinho aqui, sem depender de nada
 * deles.
 *
 * Duas fontes, nesta ordem:
 * 1. Regra do dono (`contem` → categoria): o PRD só pede "sem diferenciar
 *    maiúsculas" aqui, não acento. Ele decidiu o texto da regra vendo a
 *    descrição de verdade (ex.: "IFOOD" do extrato do banco), então dobrar
 *    acento teria um efeito que ele não pediu.
 * 2. Palavra-chave embutida: o PRD pede explicitamente "aceitar com e sem
 *    acento", e a categoria só conta se already existir com o nome exato.
 */

/** O suficiente da categoria para o palpite: id, nome exato e tipo. */
export interface CategoriaParaPalpite {
  id: string;
  nome: string;
  tipo: "despesa" | "receita";
}

export interface RegraCategorizacao {
  contem: string;
  categoriaId: string;
}

/**
 * Palavras-chave por nome de categoria (PRD §8.3). A chave é o nome EXATO da
 * categoria (com acento, porque é assim que a tela grava); a comparação com a
 * descrição é sempre sem acento (ver `bateAPalavra`).
 *
 * Cuidado com palavra curta virando substring de outra coisa: "net" não pode
 * casar "internet", "bar" não pode casar "barbearia", "gol" não pode casar
 * "gols", "big"/"max"/"oi"/"extra"/"light" idem. Por isso o casamento é por
 * PALAVRA INTEIRA (limite de palavra nas duas pontas), nunca `includes`.
 */
export const PALAVRAS_CHAVE_PADRAO: Record<string, string[]> = {
  "Delivery e restaurante": [
    "ifood", "rappi", "ubereats", "delivery", "restaurante", "lanchonete",
    "pizzaria", "burger", "mcdonald", "subway", "padaria",
  ],
  Transporte: [
    "uber", "99 app", "99 pop", "99 taxi", "cabify", "posto", "combustível",
    "shell", "ipiranga", "petrobras", "estacionamento", "pedágio", "metrô",
    "ônibus", "bilhete único",
  ],
  Mercado: [
    "mercado", "supermercado", "atacado", "atacadão", "assaí", "carrefour",
    "pão de açúcar", "extra", "big", "hortifruti", "sacolão",
  ],
  Saúde: [
    "farmácia", "drogaria", "drogasil", "pague menos", "raia", "panvel",
    "hospital", "clínica", "laboratório", "unimed", "amil", "dentista",
  ],
  Assinaturas: [
    "netflix", "spotify", "amazon prime", "disney", "hbo", "max", "globoplay",
    "youtube", "apple.com", "icloud", "google one", "deezer", "assinatura",
  ],
  Moradia: ["aluguel", "condomínio", "iptu", "financiamento", "prestação da casa"],
  "Contas da casa": [
    "energia", "enel", "cemig", "copel", "light", "sabesp", "copasa", "água",
    "gás", "internet", "vivo", "claro", "tim", "oi fibra", "net",
  ],
  Lazer: [
    "cinema", "bar", "cerveja", "balada", "show", "ingresso", "teatro",
    "viagem", "hotel", "airbnb", "passagem", "latam", "gol", "azul",
  ],
  Educação: ["escola", "faculdade", "curso", "udemy", "alura", "livro", "papelaria", "material escolar"],
  "Cuidados pessoais": [
    "salão", "barbearia", "cabelo", "manicure", "academia", "smartfit",
    "gympass", "perfume", "boticário", "natura",
  ],
  Pets: ["petz", "cobasi", "veterinário", "ração"],
  Salário: ["salário", "pagamento de salário", "proventos", "rendimento", "pix recebido", "transferência recebida"],
};

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

function escaparRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A palavra-chave bate por PALAVRA INTEIRA na descrição já sem acento (ver o comentário de `PALAVRAS_CHAVE_PADRAO`). */
function bateAPalavra(descricaoSemAcento: string, palavra: string): boolean {
  const p = escaparRegex(semAcento(palavra));
  return new RegExp(`(^|[^\\p{L}\\p{N}])${p}([^\\p{L}\\p{N}]|$)`, "u").test(descricaoSemAcento);
}

/**
 * O palpite de categoria (PRD §8.3): primeiro a regra do dono, depois a
 * palavra-chave embutida (ou a passada em `palavrasChave`, para quando a
 * config assumir isso, CLAUDE.md §5.6), senão `null` (quem chamou decide o
 * padrão, como "Outros gastos").
 *
 * `tipo`, se informado, restringe a busca de categoria (de regra e de
 * palavra-chave) àquele tipo, para não candidatar uma categoria de receita
 * a uma descrição de saída (e vice-versa) só porque o nome bate.
 */
export function palpitarCategoria(
  descricao: string,
  regras: RegraCategorizacao[],
  categorias: CategoriaParaPalpite[],
  tipo?: "despesa" | "receita",
  palavrasChave: Record<string, string[]> = PALAVRAS_CHAVE_PADRAO,
): string | null {
  const descMin = descricao.toLowerCase();
  for (const regra of regras) {
    if (!regra.contem) continue;
    if (!descMin.includes(regra.contem.toLowerCase())) continue;
    const categoria = categorias.find((c) => c.id === regra.categoriaId && (!tipo || c.tipo === tipo));
    if (categoria) return categoria.id;
  }

  const descSemAcento = semAcento(descricao);
  for (const [nome, palavras] of Object.entries(palavrasChave)) {
    const categoria = categorias.find((c) => c.nome === nome && (!tipo || c.tipo === tipo));
    if (!categoria) continue;
    if (palavras.some((p) => bateAPalavra(descSemAcento, p))) return categoria.id;
  }

  return null;
}
