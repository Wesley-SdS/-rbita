import { decodificarEntidades } from "../texto/entidades";
import { tabelaMarkdown } from "./texto";

/**
 * Texto de dentro do XML do Office (ODF e OOXML), sem biblioteca de XML. PURO.
 *
 * Só se lê o texto e a estrutura mínima (parágrafo, quebra, tabela). Nada de
 * DTD, entidade externa ou instrução de processamento é interpretado: o XML é
 * tratado como texto marcado, então um "XXE" num ODT não tem onde agir.
 */

export function textoXml(s: string): string {
  // sem "&" não há entidade: pular as oito trocas pesa num XML com milhares de pedaços de texto
  return s.includes("&") ? decodificarEntidades(s.replace(/&apos;/g, "'")) : s;
}

interface Tag {
  nome: string;
  fecha: boolean;
  sozinha: boolean;
  atributos: string;
}

/**
 * `indexOf` com memória: "não há `>` depois daqui" vale para todo `<` seguinte.
 * Sem isto, um arquivo de `<a<a<a…` sem nenhum `>` procurava o fim de novo a
 * cada `<`, e o custo voltava a ser quadrático.
 */
function buscador(xml: string) {
  const memo = new Map<string, { de: number; em: number }>();
  return (alvo: string, de: number): number => {
    const m = memo.get(alvo);
    if (m && de >= m.de && (m.em === -1 || m.em >= de)) return m.em;
    const em = xml.indexOf(alvo, de);
    memo.set(alvo, { de, em });
    return em;
  };
}

const NOME_DE_TAG = /^[\w:.-]+/;

/**
 * Percorre o XML entregando tags e texto, na ordem, com a posição de cada um.
 *
 * Tokenizador à mão, e não uma regex só: a regex antiga (`<(\/?)([\w:.-]+)
 * ([^>]*?)(\/?)>|…`) recomeçava do zero a cada `<` sem `>` depois, e um ODT de
 * 470 bytes que infla para `<a<a<a…` parou o processo inteiro por 19 s (medido
 * na revisão de 11/10/2026). Aqui cada caractere é visto um número fixo de vezes.
 */
export function* tokens(xml: string): Generator<({ tag: Tag } | { texto: string }) & { inicio: number; fim: number }> {
  const buscar = buscador(xml);
  let i = 0;
  const n = xml.length;
  while (i < n) {
    // o próximo "<" sempre anda para a frente: indexOf direto já é linear no total
    const lt = xml.indexOf("<", i);
    if (lt === -1) {
      yield { texto: textoXml(xml.slice(i)), inicio: i, fim: n };
      return;
    }
    if (lt > i) yield { texto: textoXml(xml.slice(i, lt)), inicio: i, fim: lt };
    if (xml.startsWith("<!--", lt)) {
      const f = buscar("-->", lt + 4);
      if (f !== -1) {
        i = f + 3;
        continue;
      }
    } else if (xml.startsWith("<?", lt)) {
      const f = buscar("?>", lt + 2);
      if (f !== -1) {
        i = f + 2;
        continue;
      }
    } else if (xml.startsWith("<![CDATA[", lt)) {
      const f = buscar("]]>", lt + 9);
      if (f !== -1) {
        yield { texto: xml.slice(lt + 9, f), inicio: lt, fim: f + 3 };
        i = f + 3;
        continue;
      }
    }
    const gt = buscar(">", lt + 1);
    // `<` que não abre nada (sem `>` depois, ou sem nome de tag) é pulado, como antes
    if (gt === -1) {
      i = lt + 1;
      continue;
    }
    if (xml[lt + 1] === "!") {
      i = gt + 1;
      continue;
    }
    const fecha = xml[lt + 1] === "/";
    const dentro = xml.slice(lt + (fecha ? 2 : 1), gt);
    const nome = NOME_DE_TAG.exec(dentro)?.[0];
    if (!nome) {
      i = lt + 1;
      continue;
    }
    const sozinha = dentro.endsWith("/") && dentro.length > nome.length;
    yield { tag: { nome, fecha, sozinha, atributos: dentro.slice(nome.length, sozinha ? -1 : undefined) }, inicio: lt, fim: gt + 1 };
    i = gt + 1;
  }
}

/** O valor de um atributo (`nome="…"`), sem regex: linear mesmo com atributo sem aspas de fechamento. */
export function atributo(atributos: string, nome: string): string | null {
  let de = 0;
  for (;;) {
    const p = atributos.indexOf(nome, de);
    if (p === -1) return null;
    let j = p + nome.length;
    while (j < atributos.length && /\s/.test(atributos[j]!)) j++;
    if (atributos[j] === "=") {
      j++;
      while (j < atributos.length && /\s/.test(atributos[j]!)) j++;
      if (atributos[j] === '"') {
        const f = atributos.indexOf('"', j + 1);
        // sem aspas de fechamento aqui, também não há depois: não adianta procurar de novo
        if (f === -1) return null;
        return textoXml(atributos.slice(j + 1, f));
      }
    }
    de = p + 1;
  }
}

/** Nome sem o prefixo de namespace ("a:t" → "t"). */
const local = (nome: string) => nome.slice(nome.indexOf(":") + 1);

/**
 * O trecho entre a primeira `<nome …>` e o primeiro `</nome>` (com ou sem
 * prefixo), e o texto direto de um elemento. Substituem as regex com
 * `[\s\S]*?` que, sem o fechamento, varriam até o fim a cada abertura.
 */
export function blocoXml(xml: string, nome: string): string {
  let inicio = -1;
  for (const tk of tokens(xml)) {
    if (!("tag" in tk) || local(tk.tag.nome) !== nome) continue;
    if (inicio === -1 && !tk.tag.fecha && !tk.tag.sozinha) inicio = tk.fim;
    else if (inicio !== -1 && tk.tag.fecha) return xml.slice(inicio, tk.inicio);
  }
  return "";
}

/** Todos os blocos `<nome>…</nome>`, em ordem (o primeiro fechamento encerra cada um). */
export function blocosXml(xml: string, nome: string): string[] {
  const out: string[] = [];
  let inicio = -1;
  for (const tk of tokens(xml)) {
    if (!("tag" in tk) || local(tk.tag.nome) !== nome) continue;
    if (!tk.tag.fecha && !tk.tag.sozinha) inicio = inicio === -1 ? tk.fim : inicio;
    else if (tk.tag.fecha && inicio !== -1) {
      out.push(xml.slice(inicio, tk.inicio));
      inicio = -1;
    }
  }
  return out;
}

/** O texto de `<nome>texto</nome>`: o primeiro elemento que tem só texto dentro. */
export function textoDoElemento(xml: string, nome: string): string | null {
  let aberto = false;
  let texto = "";
  for (const tk of tokens(xml)) {
    if ("texto" in tk) {
      if (aberto) texto += tk.texto;
      continue;
    }
    const igual = local(tk.tag.nome) === nome;
    if (igual && !tk.tag.fecha && !tk.tag.sozinha) {
      aberto = true;
      texto = "";
    } else if (igual && tk.tag.fecha && aberto) {
      return texto.trim() || null;
    } else aberto = false;
  }
  return null;
}

/**
 * Corpo de ODF (content.xml do ODT e da ODP) em texto com tabelas Markdown.
 *
 * `paginas`: na ODP cada `draw:page` é um slide e as notas (`presentation:notes`)
 * vêm separadas; no ODT o documento é uma parte só.
 */
export function textoOdf(xml: string): { partes: { texto: string; notas: string; nome: string | null }[]; tabelas: number } {
  const partes: { texto: string; notas: string; nome: string | null }[] = [];
  let atual = { texto: "", notas: "", nome: null as string | null };
  let emNotas = 0;
  let tabelas = 0;
  // pilha de tabelas (tabela dentro de célula existe): cada uma com linhas e a célula aberta
  const pilha: { linhas: string[][]; linha: string[] | null; celula: string | null }[] = [];
  const escrever = (t: string) => {
    const tab = pilha[pilha.length - 1];
    if (tab && tab.celula !== null) tab.celula += t;
    else if (emNotas) atual.notas += t;
    else atual.texto += t;
  };
  for (const tk of tokens(xml)) {
    if ("texto" in tk) {
      escrever(tk.texto);
      continue;
    }
    const { nome, fecha, sozinha, atributos } = tk.tag;
    if (nome === "draw:page" && !fecha) {
      if (atual.texto.trim() || atual.notas.trim()) partes.push(atual);
      atual = { texto: "", notas: "", nome: atributo(atributos, "draw:name") };
      continue;
    }
    if (nome === "presentation:notes") {
      if (!sozinha) emNotas += fecha ? -1 : 1;
      continue;
    }
    if (nome === "text:s") {
      escrever(" ".repeat(Math.min(50, Number(atributo(atributos, "text:c") ?? 1) || 1)));
      continue;
    }
    if (nome === "text:tab") escrever("\t");
    else if (nome === "text:line-break") escrever("\n");
    else if ((nome === "text:p" || nome === "text:h") && fecha) escrever(pilha.length && pilha[pilha.length - 1]!.celula !== null ? " " : "\n");
    else if (nome === "table:table" && !fecha) pilha.push({ linhas: [], linha: null, celula: null });
    else if (nome === "table:table" && fecha) {
      const t = pilha.pop();
      const uteis = (t?.linhas ?? []).filter((l) => l.some((c) => c.trim()));
      if (uteis.length) {
        tabelas++;
        escrever(`\n${tabelaMarkdown(uteis)}\n`);
      }
    } else if (nome === "table:table-row" && pilha.length) {
      const t = pilha[pilha.length - 1]!;
      if (!fecha) t.linha = [];
      else if (t.linha) {
        t.linhas.push(t.linha);
        t.linha = null;
      }
    } else if ((nome === "table:table-cell" || nome === "table:covered-table-cell") && pilha.length) {
      const t = pilha[pilha.length - 1]!;
      if (sozinha) t.linha?.push("");
      else if (!fecha) t.celula = "";
      else {
        t.linha?.push((t.celula ?? "").replace(/\s+/g, " ").trim());
        t.celula = null;
      }
    }
  }
  if (atual.texto.trim() || atual.notas.trim()) partes.push(atual);
  return { partes, tabelas };
}

/**
 * Texto de um slide (ou página de notas) do PowerPoint: um `a:p` por linha,
 * tabela (`a:tbl`) em Markdown. Formas de número do slide, data e rodapé
 * ficam de fora: são as mesmas em todo slide e só repetem ruído.
 */
export function textoDoSlide(xml: string): { texto: string; tabelas: number } {
  // um passo só pelos tokens (as regex com `[\s\S]*?` daqui eram quadráticas
  // num `<a:tbl>` repetido sem fechamento): o texto das formas sai na ordem, e
  // as tabelas vão para o fim, como antes
  const PULAR = ["sldNum", "dt", "ftr", "hdr", "sldImg"];
  const formas: string[] = [];
  const tabelasMd: string[] = [];
  let naForma = false;
  let pularForma = false;
  let doNv = false;
  let paragrafo: string | null = null;
  let emTexto = false;
  const pilha: { linhas: string[][]; linha: string[] | null; celula: string[] | null }[] = [];
  const fecharParagrafo = () => {
    const l = (paragrafo ?? "").trim();
    paragrafo = null;
    if (!l) return;
    const t = pilha[pilha.length - 1];
    if (t?.celula) t.celula.push(l);
    else if (naForma && !pularForma) formas.push(l);
  };
  for (const tk of tokens(xml)) {
    if ("texto" in tk) {
      if (emTexto && paragrafo !== null) paragrafo += tk.texto;
      continue;
    }
    const { nome, fecha, sozinha, atributos } = tk.tag;
    if (nome === "p:sp") {
      if (!fecha && !sozinha) {
        naForma = true;
        pularForma = false;
        doNv = true;
      } else if (fecha) naForma = false;
    } else if (nome === "p:nvSpPr" && fecha) doNv = false;
    else if (nome === "p:ph" && naForma && doNv) {
      if (PULAR.includes(atributo(atributos, "type") ?? "")) pularForma = true;
    } else if (nome === "a:p") {
      if (!fecha && !sozinha) paragrafo = "";
      else if (fecha) fecharParagrafo();
    } else if (nome === "a:t") emTexto = !fecha && !sozinha;
    else if (nome === "a:br" && paragrafo !== null) paragrafo += "\n";
    else if (nome === "a:tbl") {
      if (!fecha && !sozinha) pilha.push({ linhas: [], linha: null, celula: null });
      else if (fecha) {
        const t = pilha.pop();
        if (t?.linhas.length) tabelasMd.push(tabelaMarkdown(t.linhas));
      }
    } else if (nome === "a:tr" && pilha.length) {
      const t = pilha[pilha.length - 1]!;
      if (!fecha && !sozinha) t.linha = [];
      else if (fecha && t.linha) {
        t.linhas.push(t.linha);
        t.linha = null;
      }
    } else if (nome === "a:tc" && pilha.length) {
      const t = pilha[pilha.length - 1]!;
      if (!fecha && !sozinha) t.celula = [];
      else if (fecha) {
        t.linha?.push((t.celula ?? []).join(" "));
        t.celula = null;
      }
    }
  }
  return { texto: [...formas, ...tabelasMd].join("\n"), tabelas: tabelasMd.length };
}
