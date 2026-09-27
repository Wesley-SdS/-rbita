/**
 * O TEXTO COMO SE FALA, e não como se escreve.
 *
 * A resposta do chat é Markdown: negrito, lista, link, cabeçalho. Na tela isso
 * vira formatação; no alto-falante vira lixo. O dono relatou a Órbita
 * pronunciando "asterisco" no meio das frases, lendo um resumo de e-mails cheio
 * de `**Nome:**` e de links.
 *
 * A causa era ter DOIS caminhos de fala e só um limpar. O `speak` (resposta
 * inteira, de uma vez) tirava os símbolos com um `replace` de caracteres; o
 * `iniciarFluxo`, que fala enquanto o modelo escreve e é o caminho de hoje,
 * mandava o Markdown cru para o `/api/tts`. Agora os dois passam por aqui.
 *
 * E tirar os caracteres não bastava: `[texto](https://…)` viraria
 * "texto(https dois pontos barra barra…)", com a URL lida em voz alta. Link se
 * fala pelo TEXTO dele, nunca pelo endereço.
 *
 * O prompt do sistema já pede resposta sem markdown quando ela vai ser falada
 * (`system-prompt.ts`), mas isso é um PEDIDO ao modelo, e modelo esquece. Esta
 * função é a garantia, e as duas coisas convivem: a instrução melhora o texto,
 * esta limpeza impede o pior.
 */

/** E-mail e endereço soltos no meio da frase: soletrar isso em voz alta não ajuda ninguém. */
const URL_SOLTA = /\bhttps?:\/\/\S+|\bwww\.\S+/gi;

export function paraFala(texto: string): string {
  let s = texto;

  // blocos de código inteiros: ninguém quer ouvir chaves e ponto e vírgula.
  // A cerca leva a própria linha junto, senão sobraria um vão no meio da fala.
  s = s.replace(/^[ \t]*```[\s\S]*?```[ \t]*\n?/gm, "");
  s = s.replace(/```[\s\S]*?```/g, " ");
  s = s.replace(/`([^`]*)`/g, "$1");

  // imagem antes de link, senão o `!` fica órfão: ![alt](url) some inteira
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, " ");
  // link: fica o texto, cai o endereço
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  // link de referência e âncora solta: [texto][1] e [texto]
  s = s.replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1");
  s = s.replace(/\[([^\]]+)\]/g, "$1");

  // ênfase: **x**, __x__, *x*, _x_ — o conteúdo fica, o símbolo sai
  s = s.replace(/\*\*\*([^*]+)\*\*\*/g, "$1");
  s = s.replace(/\*\*([^*]+)\*\*/g, "$1");
  s = s.replace(/__([^_]+)__/g, "$1");
  s = s.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, "$1$2");
  s = s.replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,;:!?]|$)/g, "$1$2");

  // riscado ~~x~~
  s = s.replace(/~~([^~]+)~~/g, "$1");

  s = s
    .split("\n")
    .map((linha) => {
      // linha horizontal (---, ***, ___) não se fala
      if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(linha)) return "";
      // cabeçalho: ## Título → Título
      let l = linha.replace(/^\s{0,3}#{1,6}\s+/, "");
      // citação: > texto
      l = l.replace(/^\s*>+\s?/, "");
      // marcador de lista. O item VIRA FRASE: sem o ponto, o TTS emenda um
      // item no outro e a enumeração some na prosódia.
      const comMarcador = l.replace(/^\s*[-*+]\s+/, "");
      if (comMarcador !== l) return pontuar(comMarcador);
      // lista numerada: o número é informação, fica ("1. Ligar" → "1. Ligar")
      if (/^\s*\d+[.)]\s+/.test(l)) return pontuar(l.replace(/^\s*(\d+)[.)]\s+/, "$1. "));
      // linha de tabela: os pipes viram pausa
      if (/^\s*\|.*\|\s*$/.test(l)) {
        if (/^\s*\|[\s:|-]+\|\s*$/.test(l)) return ""; // a linha de traços que separa o cabeçalho
        return pontuar(l.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim()).filter(Boolean).join(", "));
      }
      return l;
    })
    .join("\n");

  s = s.replace(URL_SOLTA, " ");

  // O que sobrou de símbolo solto, e o espaço em excesso que a limpeza criou.
  //
  // `_` fica FORA desta varredura de propósito: ênfase de verdade já saiu nos
  // pares acima, e o sublinhado que sobra costuma estar dentro de uma palavra
  // (`nome_do_campo`, um nome de arquivo). Varrer tudo transformava isso em
  // "nomedocampo", trocando um problema de fala por um erro de conteúdo.
  return s
    .replace(/[*`#>]/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ +([.,;:!?])/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .trim();
}

/**
 * Item de lista sem pontuação vira fim de frase.
 *
 * É o que faz a Órbita respirar entre um item e o outro. Sem isto, "Ligar a luz
 * / Trancar a porta" sai numa tacada só, e quem ouve perde a conta de quantas
 * coisas foram ditas. Também é o que o `prontoParaFalar` usa para saber que já
 * dá para falar aquele pedaço.
 */
function pontuar(linha: string): string {
  const t = linha.trim();
  if (!t) return "";
  return /[.!?…:,;]$/.test(t) ? t : `${t}.`;
}
