/**
 * ONDE o dinheiro foi, pelo lugar e não pela categoria. Puro.
 *
 * O dono quer ver "iFood: 142 pedidos" (06/10/2026), e a categoria não diz
 * isso: o extrato dele tinha 100% em "Outros gastos", e mesmo categorizado
 * "Alimentação" junta o mercado com o delivery. A descrição diz, mas cada
 * compra vem escrita de um jeito ("IFOOD *BK BRASIL", "iFood *Habibs",
 * "Pix enviado Eliane…"). Este arquivo transforma a descrição no LUGAR, para
 * as compras do mesmo lugar somarem juntas.
 *
 * Errar para o lado de separar é o certo: dois lugares que deviam ser um
 * aparecem como duas linhas (o dono entende), e dois lugares diferentes
 * juntos somariam um número que não existe.
 */

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Marcas que chegam escritas de muitos jeitos: o nome de gente para cada uma. */
const MARCAS: [RegExp, string][] = [
  [/\bifood\b|\bifd\*/i, "iFood"],
  [/\buber\s*\*?\s*eats\b/i, "Uber Eats"],
  [/\buber\b/i, "Uber"],
  [/\b99\s*(app|pop|taxi|tecnologia)\b|\b99app\b/i, "99"],
  [/\brappi\b/i, "Rappi"],
  [/\bz[eé]\s*delivery\b/i, "Zé Delivery"],
  [/\bamazon\b|\bamzn\b/i, "Amazon"],
  [/\bmercado\s*livre\b|\bmercadolivre\b/i, "Mercado Livre"],
  [/\bshopee\b/i, "Shopee"],
  [/\baliexpress\b/i, "AliExpress"],
  [/\bshein\b/i, "Shein"],
  [/\btemu\b/i, "Temu"],
  [/\bmagalu\b|\bmagazine\s*luiza\b/i, "Magalu"],
  [/\bkabum\b/i, "KaBuM!"],
  [/\bnetflix\b/i, "Netflix"],
  [/\bspotify\b/i, "Spotify"],
  [/\bdisney\s*\+?|\bdisneyplus\b/i, "Disney+"],
  [/\bprime\s*video\b/i, "Prime Video"],
  [/\bhbo\s*max\b|\bmax\.com\b/i, "Max"],
  [/\bapple\.com\b|\bitunes\b|\bapple\b/i, "Apple"],
  [/\bgoogle\b/i, "Google"],
  [/\bopenai\b|\bchatgpt\b/i, "OpenAI"],
  [/\banthropic\b|\bclaude\.ai\b/i, "Anthropic"],
  [/\bshell\b/i, "Posto Shell"],
  [/\bipiranga\b/i, "Posto Ipiranga"],
  [/\bpetrobras\b|\bposto\s*br\b|\bbr\s*mania\b/i, "Posto BR"],
  [/\bsem\s*parar\b/i, "Sem Parar"],
  [/\bdrogasil\b/i, "Drogasil"],
  [/\b(droga\s*)?raia\b/i, "Droga Raia"],
  [/\bpague\s*menos\b/i, "Pague Menos"],
  [/\bcarrefour\b/i, "Carrefour"],
  [/\bassa[ií]\b/i, "Assaí"],
  [/\batacad[aã]o\b/i, "Atacadão"],
  [/\bp[aã]o\s*de\s*a[cç][uú]car\b/i, "Pão de Açúcar"],
  [/\bclaro\b/i, "Claro"],
  [/\bvivo\b|\btelefonica\b/i, "Vivo"],
  [/\btim\s*(s\.?a|celular|brasil)?\b(?!\w)/i, "TIM"],
  [/\benel\b/i, "Enel"],
  [/\bsabesp\b/i, "Sabesp"],
  [/\bcemig\b/i, "Cemig"],
  [/\bcomg[aá]s\b/i, "Comgás"],
];

/** Quem processa o pagamento escreve o próprio nome antes do `*`: o lugar é o que vem depois. */
const PROCESSADORAS = /^(pag|pagseguro|ps|mp|mercadopago|pg|ec|sumup|stone|cielo|getnet|ppro|paypal|pp|iz|picpay|ebanx|dlo|dlocal|pagarme|cs|htm)$/i;

/** O que vem antes do lugar e não diz nada sobre ele. Aplicado repetidas vezes. */
const PREFIXO = /^(pix(\s+(enviado|recebido|transf\w*|agendado))?(\s+(para|de|a))?|ted(\s+(para|de))?|doc(\s+(para|de))?|transfer[eê]ncia(\s+(enviada|recebida|realizada))?(\s+(para|de))?|pagamento(\s+(de|do|da))?(\s+(boleto|fatura|conta|titulo|t[ií]tulo))?(\s+(de|do|da))?|pagto|pgto|compra(\s+(no|com|em))?(\s+(d[eé]bito|cr[eé]dito|cart[aã]o))?|d[eé]bito(\s+autom[aá]tico)?|boleto|cobran[cç]a|recebimento(\s+de)?|estorno(\s+de)?)\s+/i;

/** A partir daqui, é razão social ou código: "Comercial Lt", "Instituicao Pa", "S/A". */
const RABO = /\s+(ltda?|lt|s\/?a|s\.a\.?|eireli|epp|me|cia|comercial|comercio|com[eé]rcio|servi[cç]os?|instituicao|institui[cç][aã]o|pagamentos?|participacoes|participa[cç][oõ]es|holding|brasil\s+ltda)\b.*$/i;

const MINUSCULAS = new Set(["de", "da", "do", "das", "dos", "e", "em", "a", "o"]);

function titulo(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w, i) => (i > 0 && MINUSCULAS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

export function lugarDaDescricao(descricao: string | null | undefined): string {
  let s = (descricao ?? "").replace(/\s+/g, " ").trim();
  if (!s) return "Sem descrição";
  for (const [re, nome] of MARCAS) if (re.test(semAcento(s))) return nome;

  // "PAG*PADARIA BELA" é a padaria; "BURGER KING*SHOPPING" é o Burger King
  if (s.includes("*")) {
    const [antes, ...depois] = s.split("*");
    const resto = depois.join(" ").trim();
    s = PROCESSADORAS.test(antes!.trim()) && resto ? resto : antes!.trim() || resto;
  }
  for (let i = 0; i < 4; i++) {
    const sem = s.replace(PREFIXO, "");
    if (sem === s) break;
    s = sem;
  }
  s = s
    .replace(RABO, "")
    .replace(/\s+(sao paulo|s[aã]o paulo|rio de janeiro|belo horizonte|curitiba|br|bra|brasil)$/i, "")
    .replace(/[\s\-–—/.,:#]*\d[\d\s\-/.]*$/, "")
    .replace(/[\s\-–—/.,:#*]+$/, "")
    .trim();
  if (!s) return "Sem descrição";
  // tudo em maiúscula (extrato de cartão) vira nome de gente; o que já tem caixa mista fica
  const nome = s === s.toUpperCase() || s === s.toLowerCase() ? titulo(s) : s;
  return nome.length > 40 ? `${nome.slice(0, 39).trimEnd()}…` : nome;
}
