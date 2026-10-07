/**
 * O markdown do modelo no formato que o WhatsApp entende. PURO.
 *
 * O modelo escreve como no chat (`**negrito**`, `## Título`, listas com `-`,
 * `[texto](link)`), e o WhatsApp mostrava tudo cru: 14 mensagens da Órbita
 * chegaram com "#" e "##" na frente, e o dono reclamou da formatação
 * (05/10/2026). O WhatsApp tem a sua própria marcação: `*negrito*`,
 * `_itálico_`, `~riscado~` e bloco de código com três crases, que fica como está.
 *
 * Roda na entrada única de envio (`enviarTexto`), ANTES de registrar a saída:
 * o eco é casado pelo hash do que de fato saiu.
 */
export function paraWhatsapp(texto: string): string {
  const linhas = texto.replace(/\r\n/g, "\n").split("\n");
  const saida: string[] = [];
  let emCodigo = false;
  for (const bruta of linhas) {
    if (/^\s*```/.test(bruta)) {
      emCodigo = !emCodigo;
      saida.push(bruta);
      continue;
    }
    if (emCodigo) {
      saida.push(bruta);
      continue;
    }
    let l = bruta;
    // separador de tabela e régua não dizem nada no celular
    if (/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(l) || /^\s*([-*_])\1{2,}\s*$/.test(l)) continue;
    // título vira uma linha em negrito
    const titulo = l.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (titulo) l = `*${titulo[1]!.replace(/\*\*/g, "")}*`;
    // linha de tabela vira itens separados por ponto
    else if (/^\s*\|.*\|\s*$/.test(l)) l = l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()).filter(Boolean).join(" · ");
    // marcador de lista vira bolinha (o "-" no começo da linha some no WhatsApp)
    l = l.replace(/^(\s*)[-*+]\s+/, "$1• ");
    l = l
      .replace(/\*\*(.+?)\*\*/g, "*$1*")
      .replace(/__(.+?)__/g, "_$1_")
      .replace(/~~(.+?)~~/g, "~$1~")
      // link: o texto e o endereço, para dar para tocar
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (_, t: string, u: string) => (t === u ? u : `${t} (${u})`))
      // travessão não vai em texto para o dono (CLAUDE.md §6): entre palavras
      // vira vírgula, solto vira hífen. O modelo usa mesmo pedindo que não use
      .replace(/\s+[—–]\s+/g, ", ")
      .replace(/[—–]/g, "-");
    saida.push(l);
  }
  // título repetido logo em seguida ("## Resumo" e "### Resumo") vira um só
  const sem = saida.filter((l, i) => !(i > 0 && /^\*[^*]+\*$/.test(l) && l === saida[i - 1]));
  // Título em negrito sozinho na linha ganha uma linha em branco depois, e
  // antes também (quando não é o começo): no celular, título colado no texto
  // vira um bloco só, e o dono pediu mais respiro entre título e parágrafo.
  const comRespiro: string[] = [];
  sem.forEach((l, i) => {
    const titulo = /^\*[^*\n]+\*:?$/.test(l.trim());
    if (titulo && comRespiro.length && comRespiro[comRespiro.length - 1] !== "") comRespiro.push("");
    comRespiro.push(l);
    if (titulo && i < sem.length - 1 && sem[i + 1] !== "") comRespiro.push("");
  });
  return comRespiro.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
