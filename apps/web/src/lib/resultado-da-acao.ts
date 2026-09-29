/**
 * O resultado de uma ação aprovada, arrumado para a tela. PURA.
 *
 * O servidor devolve uma frase ("Evento criado na agenda de fulano@x.com:
 * https://www.google.com/calendar/event?eid=…"), e mostrar isso cru deixava
 * uma URL de três linhas no meio do cartão. Aqui a frase perde a URL e a conta,
 * que viram um link curto e uma etiqueta.
 */

export interface ResultadoArrumado {
  texto: string;
  conta: string | null;
  links: { url: string; rotulo: string }[];
}

const URL = /https?:\/\/[^\s<>"')]+/g;
// "na agenda de x@y", "pela conta x@y", "conta x@y" (e o mesmo sem e-mail, como "Outlook, conta Trabalho")
const CONTA = /(?:na agenda de|pela conta|pelo outlook, conta|, conta|\bconta)\s+([^\s:,()]+@[^\s:,()]+)/i;

function rotuloDoLink(url: string): string {
  const u = url.toLowerCase();
  if (u.includes("calendar") || u.includes("outlook.office.com/calendar")) return "Abrir na agenda";
  if (u.includes("mail.google") || u.includes("outlook.office.com/mail")) return "Abrir o e-mail";
  if (u.includes("atlassian.net")) return "Abrir no Jira";
  if (u.includes("notion.so")) return "Abrir no Notion";
  return "Abrir";
}

export function arrumarResultado(bruto: string | null | undefined): ResultadoArrumado {
  let texto = (bruto ?? "").trim();
  const links = [...new Set(texto.match(URL) ?? [])].map((url) => ({ url, rotulo: rotuloDoLink(url) }));
  texto = texto.replace(URL, "");
  const conta = CONTA.exec(texto)?.[1] ?? null;
  if (conta) texto = texto.replace(CONTA, "");
  // o que sobrou da frase, sem o "de :" ou pontuação solta que a remoção deixou
  texto = texto
    .replace(/\s+([:.,])/g, "$1")
    .replace(/[:,]\s*$/, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (texto && !/[.!?]$/.test(texto)) texto += ".";
  return { texto, conta, links };
}
