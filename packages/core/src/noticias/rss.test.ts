import { describe, expect, it } from "vitest";
import { enderecoDoRss, lerRss, linkDoBingNoticias, recentes } from "./rss";
import { novasNoticias } from "./selecao";

// recortes do que o Bing e o Google devolveram em 06/10/2026
const BING = `<?xml version="1.0" encoding="utf-8" ?><rss version="2.0"><channel><title>ia - BingNot&#237;cias</title>
<item><title>SEGA barra intelig&#234;ncia artificial e promete jogos feitos por humanos</title><link>http://www.bing.com/news/apiclick.aspx?ref=FexRss&amp;aid=&amp;tid=6ac5&amp;url=https%3a%2f%2fcanaltech.com.br%2fgames%2fsega-barra-inteligencia-artificial%2f&amp;c=123&amp;mkt=pt-br</link><description>Em entrevista ao ve&#237;culo Nikkei, o diretor da SEGA afirmou ...</description><pubDate>Tue, 06 Oct 2026 04:19:00 GMT</pubDate><News:Source>Canaltech</News:Source></item>
<item><title>Sem link</title><description>x</description></item>
</channel></rss>`;

const GOOGLE = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Google Notícias</title>
<item><title>Setor de beleza adota inteligência artificial para acelerar inovação - CNN Brasil</title><link>https://news.google.com/rss/articles/CBMivgFBVV95?oc=5</link><pubDate>Mon, 05 Oct 2026 12:00:00 GMT</pubDate><description>&lt;a href="https://news.google.com/x"&gt;Setor de beleza&lt;/a&gt;</description><source url="https://www.cnnbrasil.com.br">CNN Brasil</source></item>
</channel></rss>`;

describe("RSS de notícias", () => {
  it("Bing: o link real sai de dentro do rastreador, com veículo, data e trecho", () => {
    const [r, ...resto] = lerRss(BING, "bing");
    expect(resto).toEqual([]);
    expect(r).toMatchObject({
      titulo: "SEGA barra inteligência artificial e promete jogos feitos por humanos",
      url: "https://canaltech.com.br/games/sega-barra-inteligencia-artificial/",
      site: "Canaltech",
      materia: true,
      publicadaEm: "2026-10-06T04:19:00.000Z",
    });
    expect(r!.trecho).toContain("veículo Nikkei");
  });

  it("Google: tira o veículo do fim da manchete e não usa a descrição como trecho", () => {
    const [r] = lerRss(GOOGLE, "google");
    expect(r).toMatchObject({ titulo: "Setor de beleza adota inteligência artificial para acelerar inovação", site: "CNN Brasil", trecho: "" });
    expect(r!.url.startsWith("https://news.google.com/rss/articles/")).toBe(true);
  });

  it("matéria de agregador passa pela seleção mesmo com endereço sem cara de matéria", () => {
    const n = novasNoticias(lerRss(GOOGLE, "google"), new Set(), 5);
    expect(n).toHaveLength(1);
    expect(n[0]!.site).toBe("CNN Brasil");
  });

  it("rastreador estranho ou link comum ficam como vieram; XML quebrado não derruba", () => {
    expect(linkDoBingNoticias("https://canaltech.com.br/a")).toBe("https://canaltech.com.br/a");
    expect(linkDoBingNoticias("http://www.bing.com/news/apiclick.aspx?url=javascript:alert(1)")).toBe("http://www.bing.com/news/apiclick.aspx?url=javascript:alert(1)");
    expect(lerRss("<html>bloqueado</html>", "bing")).toEqual([]);
  });

  it("só o recente; sem data, fica", () => {
    const agora = new Date("2026-10-06T12:00:00Z");
    const itens = [{ publicadaEm: "2026-10-05T12:00:00Z" }, { publicadaEm: "2026-09-20T12:00:00Z" }, {}];
    expect(recentes(itens, 3, agora)).toEqual([{ publicadaEm: "2026-10-05T12:00:00Z" }, {}]);
  });

  it("o endereço da busca leva o tema escapado e a janela de dias no Google", () => {
    expect(enderecoDoRss("bing", " IA & saúde ", 3)).toBe("https://www.bing.com/news/search?q=IA%20%26%20sa%C3%BAde&format=rss&setlang=pt-BR&cc=BR");
    expect(enderecoDoRss("google", "IA", 2)).toContain("q=IA+when:2d&hl=pt-BR");
  });
});
