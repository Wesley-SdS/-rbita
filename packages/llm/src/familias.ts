/**
 * Reduzir o catálogo ao ÚLTIMO de cada família.
 *
 * Com a chave do gateway ligada, a descoberta passou de um punhado de modelos
 * para 378, e o seletor virava uma lista nativa impossível de usar. Só que a
 * resposta não é uma lista fixa de "modelos bons" no código (isso é
 * exatamente o hardcode que o projeto proíbe): é uma REGRA sobre o que a
 * descoberta trouxer.
 *
 * A regra: mesmo provedor, mesmo nome sem o número da versão, é a mesma
 * família — e dela fica a versão mais alta. `gpt-5.1` e `gpt-5` são a mesma
 * família e sobra o 5.1; `gpt-5.1` e `gpt-5.1-codex` são famílias diferentes,
 * porque "codex" não é versão, é outro produto.
 */

/** Um pedaço que é versão: `5`, `5.1`, `2024-08-06`, `4o`. */
const VERSAO = /^v?\d+(?:[.\-]\d+)*[a-z]?$/i;
/** Rótulos que dizem "ainda não é o definitivo". Entre iguais, o estável ganha. */
const PROVISORIO = /^(preview|exp|experimental|beta|alpha|rc|nightly|latest)$/i;

export interface Familia {
  /** chave estável da família (provedor + nome sem versão) */
  chave: string;
  /** versão comparável, do mais significativo para o menos */
  versao: number[];
  provisorio: boolean;
}

/**
 * Quebra a chave de um modelo em família e versão. Puro.
 *
 * `gateway/openai/gpt-5.1-codex` → família `gateway/openai/gpt-codex`, versão [5,1]
 * `google/gemini-3.8-flash`      → família `google/gemini-flash`,      versão [3,8]
 */
export function familiaDoModelo(key: string): Familia {
  const barra = key.indexOf("/");
  const provedor = barra > 0 ? key.slice(0, barra) : "";
  const resto = barra > 0 ? key.slice(barra + 1) : key;

  // o id pode ter mais barras (`openai/gpt-5.1` dentro do gateway): só a
  // última parte carrega o nome do modelo, o resto é caminho
  const corte = resto.lastIndexOf("/");
  const caminho = corte >= 0 ? resto.slice(0, corte + 1) : "";
  const nome = corte >= 0 ? resto.slice(corte + 1) : resto;

  const pedacos = nome.split(/[-_]/).filter(Boolean);
  const versao: number[] = [];
  const restantes: string[] = [];
  let provisorio = false;

  for (const p of pedacos) {
    if (VERSAO.test(p) && versao.length === 0) {
      for (const n of p.replace(/^v/i, "").split(/[.\-]/)) {
        const v = parseInt(n, 10);
        if (!Number.isNaN(v)) versao.push(v);
      }
      continue;
    }
    if (PROVISORIO.test(p)) {
      provisorio = true;
      continue;
    }
    restantes.push(p.toLowerCase());
  }

  return { chave: `${provedor}/${caminho}${restantes.join("-")}`, versao, provisorio };
}

/** Compara duas versões. Positivo quando `a` é mais nova. */
export function compararVersao(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * O último de cada família. Entre a mesma versão, o estável ganha do preview.
 *
 * Mantém a ordem de entrada entre famílias: quem chama já ordenou por
 * provedor ou por preço, e reordenar aqui bagunçaria a tela sem motivo.
 */
export function ultimosDeCadaFamilia<T extends { key: string }>(modelos: T[]): T[] {
  const melhor = new Map<string, { item: T; fam: Familia; ordem: number }>();
  modelos.forEach((item, ordem) => {
    const fam = familiaDoModelo(item.key);
    const atual = melhor.get(fam.chave);
    if (!atual) {
      melhor.set(fam.chave, { item, fam, ordem });
      return;
    }
    const diff = compararVersao(fam.versao, atual.fam.versao);
    const ganha = diff > 0 || (diff === 0 && atual.fam.provisorio && !fam.provisorio);
    // a POSIÇÃO é da família, não do vencedor: guardar a ordem do item novo
    // faria a linha pular de lugar só porque saiu uma versão nova
    if (ganha) melhor.set(fam.chave, { item, fam, ordem: atual.ordem });
  });
  return [...melhor.values()].sort((a, b) => a.ordem - b.ordem).map((x) => x.item);
}

/** Filtro de busca do seletor: casa no rótulo e na chave, sem acento e sem caso. */
export function filtrarModelos<T extends { key: string; label: string }>(modelos: T[], busca: string): T[] {
  const alvo = busca.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();
  if (!alvo) return modelos;
  const termos = alvo.split(/\s+/);
  return modelos.filter((m) => {
    const texto = `${m.label} ${m.key}`.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    return termos.every((t) => texto.includes(t));
  });
}
