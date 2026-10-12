import { blocoXml, blocosXml, textoDoElemento } from "../xml";
import { semPontuacaoFinal } from "../texto";
import type { ContatoLido, EventoLido, NotaFiscalLida } from "../tipos";

/**
 * Convite de agenda (ICS), contato (VCF) e nota fiscal eletrônica (XML da
 * NF-e) viram DADO estruturado, não só texto. PURO.
 *
 * É o que permite à tool oferecer o próximo passo certo: "criar este evento"
 * (pela fila de aprovação, `criar_evento`), "salvar este contato", "lançar
 * esta compra". Nenhum deles acontece aqui: ler é só ler.
 */

/** Linhas do iCalendar/vCard com a continuação desdobrada (RFC 5545 §3.1). */
function linhasDesdobradas(texto: string): string[] {
  return texto.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "").split("\n").filter((l) => l.trim());
}

interface Propriedade {
  nome: string;
  params: Record<string, string>;
  valor: string;
}

function propriedade(linha: string): Propriedade | null {
  // o valor começa no primeiro ":" fora de aspas
  let aspas = false;
  let corte = -1;
  for (let i = 0; i < linha.length; i++) {
    if (linha[i] === '"') aspas = !aspas;
    else if (linha[i] === ":" && !aspas) {
      corte = i;
      break;
    }
  }
  if (corte < 0) return null;
  const [nome, ...params] = linha.slice(0, corte).split(";");
  const p: Record<string, string> = {};
  for (const par of params) {
    const [k, ...v] = par.split("=");
    if (k) p[k.toUpperCase()] = v.join("=").replace(/^"|"$/g, "");
  }
  return { nome: (nome ?? "").toUpperCase(), params: p, valor: linha.slice(corte + 1) };
}

const desescapar = (s: string) => s.replace(/\\n/gi, "\n").replace(/\\([,;\\])/g, "$1").trim();

/** "20261015T140000Z" → ISO; "20261015" → "2026-10-15" (dia inteiro). Com TZID, fica sem fuso explícito. */
export function dataDoIcs(valor: string, tzid?: string): { iso: string | null; diaInteiro: boolean } {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(valor.trim());
  if (!m) return { iso: null, diaInteiro: false };
  const [, a, me, d, h, mi, s, z] = m;
  if (!h) return { iso: `${a}-${me}-${d}`, diaInteiro: true };
  const base = `${a}-${me}-${d}T${h}:${mi}:${s ?? "00"}`;
  return { iso: z ? `${base}Z` : tzid ? `${base} (${tzid})` : base, diaInteiro: false };
}

export function lerIcs(texto: string): EventoLido[] {
  const eventos: EventoLido[] = [];
  let atual: Propriedade[] | null = null;
  for (const linha of linhasDesdobradas(texto)) {
    const p = propriedade(linha);
    if (!p) continue;
    if (p.nome === "BEGIN" && p.valor.toUpperCase() === "VEVENT") atual = [];
    else if (p.nome === "END" && p.valor.toUpperCase() === "VEVENT" && atual) {
      const um = (n: string) => atual!.find((x) => x.nome === n);
      const inicio = um("DTSTART");
      const fim = um("DTEND");
      const di = inicio ? dataDoIcs(inicio.valor, inicio.params.TZID) : { iso: null, diaInteiro: false };
      const quem = (x?: Propriedade) => (x ? x.params.CN || x.valor.replace(/^mailto:/i, "") : null);
      eventos.push({
        titulo: desescapar(um("SUMMARY")?.valor ?? "") || "(sem título)",
        inicio: di.iso,
        fim: fim ? dataDoIcs(fim.valor, fim.params.TZID).iso : null,
        diaInteiro: di.diaInteiro,
        local: um("LOCATION") ? desescapar(um("LOCATION")!.valor) || null : null,
        descricao: um("DESCRIPTION") ? desescapar(um("DESCRIPTION")!.valor) || null : null,
        organizador: quem(um("ORGANIZER")),
        participantes: atual.filter((x) => x.nome === "ATTENDEE").map((x) => quem(x)!).filter(Boolean),
      });
      atual = null;
    } else if (atual) atual.push(p);
  }
  return eventos;
}

export function textoDosEventos(eventos: EventoLido[]): string {
  return eventos
    .map((e) =>
      [
        `Evento: ${e.titulo}`,
        e.inicio ? `Início: ${e.inicio}${e.diaInteiro ? " (dia inteiro)" : ""}` : null,
        e.fim ? `Fim: ${e.fim}` : null,
        e.local ? `Local: ${e.local}` : null,
        e.organizador ? `Organizador: ${e.organizador}` : null,
        e.participantes.length ? `Participantes: ${e.participantes.join(", ")}` : null,
        e.descricao ? `Descrição: ${e.descricao}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");
}

export function lerVcf(texto: string): ContatoLido[] {
  const contatos: ContatoLido[] = [];
  let atual: Propriedade[] | null = null;
  for (const linha of linhasDesdobradas(texto)) {
    const p = propriedade(linha);
    if (!p) continue;
    // "item1.TEL" (Apple) vira "TEL"
    p.nome = p.nome.replace(/^ITEM\d+\./, "");
    if (p.nome === "BEGIN" && p.valor.toUpperCase() === "VCARD") atual = [];
    else if (p.nome === "END" && p.valor.toUpperCase() === "VCARD" && atual) {
      const todos = (n: string) => atual!.filter((x) => x.nome === n).map((x) => desescapar(x.valor)).filter(Boolean);
      const n = atual.find((x) => x.nome === "N")?.valor.split(";") ?? [];
      const nome = todos("FN")[0] || [n[1], n[0]].filter(Boolean).join(" ").trim() || "(sem nome)";
      const adr = atual.find((x) => x.nome === "ADR")?.valor.split(";").map((s) => desescapar(s)).filter(Boolean).join(", ");
      contatos.push({ nome, telefones: todos("TEL"), emails: todos("EMAIL"), empresa: semPontuacaoFinal(todos("ORG")[0] ?? "", ";") || null, aniversario: todos("BDAY")[0] || null, endereco: adr || null });
      atual = null;
    } else if (atual) atual.push(p);
  }
  return contatos;
}

export function textoDosContatos(contatos: ContatoLido[]): string {
  return contatos
    .map((c) =>
      [
        `Contato: ${c.nome}`,
        c.telefones.length ? `Telefone: ${c.telefones.join(", ")}` : null,
        c.emails.length ? `E-mail: ${c.emails.join(", ")}` : null,
        c.empresa ? `Empresa: ${c.empresa}` : null,
        c.aniversario ? `Aniversário: ${c.aniversario}` : null,
        c.endereco ? `Endereço: ${c.endereco}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");
}

/* --- NF-e ------------------------------------------------------------------ */

// O primeiro <tag> com texto e o trecho de um bloco, sem prefixo de namespace.
// Pelos tokens do XML: as regex com `[^>]*` e `[\s\S]*?` daqui eram quadráticas
// num XML com a mesma abertura repetida e sem fechamento (B5 da revisão).
const tag = (xml: string, nome: string): string | null => textoDoElemento(xml, nome);
const bloco = (xml: string, nome: string): string => blocoXml(xml, nome);
const numero = (s: string | null) => (s !== null && s !== "" && Number.isFinite(Number(s)) ? Number(s) : null);

export function lerNfe(xml: string): NotaFiscalLida {
  const emit = bloco(xml, "emit");
  const ide = bloco(xml, "ide");
  const itens = blocosXml(xml, "det").map((det) => {
    const prod = bloco(det, "prod");
    return {
      descricao: tag(prod, "xProd") ?? "(item)",
      quantidade: numero(tag(prod, "qCom")),
      unidade: tag(prod, "uCom"),
      valorUnitario: numero(tag(prod, "vUnCom")),
      valorTotal: numero(tag(prod, "vProd")),
    };
  });
  const data = (tag(ide, "dhEmi") ?? tag(ide, "dEmi"))?.slice(0, 10) ?? null;
  const chave = tag(xml, "chNFe") ?? (/Id="NFe(\d{44})"/.exec(xml)?.[1] ?? null);
  return {
    emitente: tag(emit, "xNome"),
    nomeFantasia: tag(emit, "xFant"),
    cnpj: tag(emit, "CNPJ") ?? tag(emit, "CPF"),
    numero: tag(ide, "nNF"),
    serie: tag(ide, "serie"),
    data,
    valorTotal: numero(tag(bloco(xml, "ICMSTot"), "vNF")) ?? numero(tag(xml, "vNF")),
    chave,
    itens,
  };
}

const reais = (v: number | null) => (v === null ? "?" : `R$ ${v.toFixed(2).replace(".", ",")}`);

export function textoDaNota(n: NotaFiscalLida): string {
  return [
    `Nota fiscal eletrônica${n.numero ? ` nº ${n.numero}` : ""}${n.serie ? `, série ${n.serie}` : ""}`,
    `Emitente: ${n.emitente ?? "?"}${n.nomeFantasia ? ` (${n.nomeFantasia})` : ""}${n.cnpj ? `, ${n.cnpj}` : ""}`,
    n.data ? `Data: ${n.data}` : null,
    `Valor total: ${reais(n.valorTotal)}`,
    n.chave ? `Chave de acesso: ${n.chave}` : null,
    n.itens.length ? "\nItens:" : null,
    ...n.itens.map((i) => `- ${i.descricao}: ${i.quantidade ?? "?"} ${i.unidade ?? ""} × ${reais(i.valorUnitario)} = ${reais(i.valorTotal)}`),
  ]
    .filter((l): l is string => l !== null)
    .join("\n");
}
