import { describe, expect, it } from "vitest";
import { aplicarAvaliacao, buscaDevida, consultaDoTema, novasNoticias, pareceMateria, urlCanonica } from "./selecao";

const r = (titulo: string, url: string, trecho = "") => ({ titulo, url, trecho });

describe("notícias novas", () => {
  it("o mesmo link com rastreio, www e barra final é um link só", () => {
    expect(urlCanonica("https://www.g1.globo.com/tec/ia/?utm_source=x&id=7#topo")).toBe("https://g1.globo.com/tec/ia/?id=7");
    expect(urlCanonica("https://g1.globo.com/tec/ia/")).toBe("https://g1.globo.com/tec/ia");
    expect(urlCanonica("javascript:alert(1)")).toBeNull();
    expect(urlCanonica("não é url")).toBeNull();
  });

  it("pula o que já foi mostrado, link repetido e a mesma manchete de outro site", () => {
    const vistas = new Set(["https://g1.globo.com/a"]);
    const n = novasNoticias([
      r("Antiga", "https://www.g1.globo.com/a?utm_medium=x"),
      r("IA aprova remédio novo em teste", "https://folha.uol.com.br/saude/2026/10/ia-aprova-remedio.shtml"),
      r("IA aprova remédio novo em teste no Brasil", "https://outro.com/noticia/ia-aprova-remedio-novo-brasil"),
      r("Outra coisa sobre IA", "https://folha.uol.com.br/saude/2026/10/ia-aprova-remedio.shtml/"),
      r("Hospital usa IA para triagem", "https://estadao.com.br/saude/hospital-usa-ia-para-triagem", "  Trecho   com   espaço "),
    ], vistas, 10);
    expect(n.map((x) => x.titulo)).toEqual(["IA aprova remédio novo em teste", "Hospital usa IA para triagem"]);
    expect(n[1]).toMatchObject({ site: "estadao.com.br", trecho: "Trecho com espaço" });
  });

  it("respeita o máximo e ignora resultado sem título", () => {
    const manchetes = ["Banco Central mantém juros", "Startup brasileira capta milhões", "Chuva forte atinge capital", "Seleção vence amistoso fora", "Novo remédio contra enxaqueca"];
    const muitos = manchetes.map((m, i) => r(m, `https://s${i}.com/noticia/materia-numero-${i}-de-hoje`));
    expect(novasNoticias(muitos, new Set(), 3)).toHaveLength(3);
    expect(novasNoticias([r("", "https://a.com")], new Set(), 3)).toEqual([]);
  });
});

describe("matéria ou página de seção", () => {
  it("o caso real de 06/10: as páginas de seção que vieram no lugar das matérias", () => {
    expect(pareceMateria("https://exame.com/inteligencia-artificial/", "Inteligência Artificial: ultimas notícias e novidades - Exame")).toBe(false);
    expect(pareceMateria("https://veja.abril.com.br/noticias-sobre/inteligencia-artificial/", "Notícias sobre Inteligencia Artificial - VEJA")).toBe(false);
    expect(pareceMateria("https://noticiarioia.com/", "Noticiário IA")).toBe(false);
    expect(pareceMateria("https://www.cnnbrasil.com.br/tudo-sobre/inteligencia-artificial/", "Inteligência Artificial | CNN Brasil")).toBe(false);
    expect(pareceMateria("https://cnnbrasil.com.br/economia/money/inteligencia-artificial", "Inteligência Artificial | CNN Brasil")).toBe(false);
    expect(pareceMateria("https://iabrasilnoticias.com.br", "IA Brasil Notícias")).toBe(false);
    expect(pareceMateria("https://g1.globo.com/tag/ia/", "IA")).toBe(false);
  });

  it("matéria de verdade passa: data no caminho, slug longo ou id numérico", () => {
    expect(pareceMateria("https://g1.globo.com/tecnologia/noticia/2026/10/05/google-lanca-chip.ghtml", "Google lança chip")).toBe(true);
    expect(pareceMateria("https://site.com/google-lanca-chip-para-satelites-em-orbita", "Google lança chip")).toBe(true);
    expect(pareceMateria("https://site.com/123456", "Google lança chip")).toBe(true);
    expect(pareceMateria("https://site.com/tecnologia/noticia/987654/chip", "Google lança chip")).toBe(true);
    expect(pareceMateria("não é url", "x")).toBe(false);
  });
});

describe("avaliação do modelo", () => {
  const c = (titulo: string, trecho = "trecho da busca") => ({ titulo, url: `https://x.com/${titulo}`, site: "x.com", trecho });
  it("tira o que não é do tema, usa o resumo e cai no trecho sem ele", () => {
    const r = aplicarAvaliacao([c("a"), c("b"), c("c")], [
      { n: 1, doTema: true, resumo: "Resumo de a — com travessão." },
      { n: 2, doTema: false, resumo: "fora do tema" },
      { n: 3, doTema: true, resumo: "  " },
    ]);
    expect(r.map((x) => [x.candidata.titulo, x.resumo])).toEqual([["a", "Resumo de a, com travessão."], ["c", "trecho da busca"]]);
  });

  it("sem avaliação para uma matéria, ela fica (o modelo esqueceu, não reprovou)", () => {
    expect(aplicarAvaliacao([c("a"), c("b")], [{ n: 1, doTema: true, resumo: "ok" }]).map((x) => x.candidata.titulo)).toEqual(["a", "b"]);
  });
});

describe("quando buscar", () => {
  const as = (minutos: number, dia = "2026-10-06") => ({ dia, minutos, diaDaSemana: 2 });
  it("uma vez por dia, a partir do horário", () => {
    expect(buscaDevida(as(6 * 60 + 59), "07:00", null)).toBe(false);
    expect(buscaDevida(as(7 * 60), "07:00", null)).toBe(true);
    expect(buscaDevida(as(20 * 60), "07:00", "2026-10-05")).toBe(true);
    expect(buscaDevida(as(20 * 60), "07:00", "2026-10-06")).toBe(false);
    expect(buscaDevida(as(9 * 60), "hora errada", null)).toBe(false);
  });

  it("a consulta puxa para notícia", () => {
    expect(consultaDoTema("  IA na saúde ")).toBe("IA na saúde notícias");
    expect(consultaDoTema("IA", "outubro 2026")).toBe("IA notícias outubro 2026");
  });
});
