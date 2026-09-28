import { normalizarTelefone, type ContatoAgenda } from "./casar";

/**
 * Cliente da People API (Google Contatos). O escopo `contacts` já vinha no
 * login do Google desde o começo; faltava quem usasse.
 */

interface Pessoa {
  names?: { displayName?: string }[];
  nicknames?: { value?: string }[];
  emailAddresses?: { value?: string }[];
  phoneNumbers?: { value?: string; canonicalForm?: string }[];
  birthdays?: { date?: { year?: number; month?: number; day?: number } }[];
  organizations?: { name?: string }[];
}

interface Pagina {
  connections?: Pessoa[];
  nextPageToken?: string;
}

/** Uma pessoa da People API → contato da Órbita. PURA. Sem nome e sem meio de contato, some. */
export function lerPessoa(p: Pessoa): ContatoAgenda | null {
  const emails = (p.emailAddresses ?? []).map((e) => e.value?.trim()).filter((e): e is string => !!e);
  // `canonicalForm` já vem em E.164 quando o Google conseguiu entender o número
  // Normalizado já na leitura: a chave do telefone (nono dígito) só funciona
  // com DDI, e "(11) 98888-7777" sem o `canonicalForm` nunca casaria com o JID
  const telefones = (p.phoneNumbers ?? [])
    .map((t) => (t.canonicalForm ?? t.value)?.trim())
    .filter((t): t is string => !!t)
    .map((t) => normalizarTelefone(t) ?? t);
  const nome = p.names?.[0]?.displayName?.trim() || emails[0] || "";
  if (!nome || (!emails.length && !telefones.length && !p.birthdays?.length)) return null;
  const d = p.birthdays?.find((b) => b.date?.month && b.date?.day)?.date;
  return {
    nome,
    apelidos: (p.nicknames ?? []).map((n) => n.value?.trim()).filter((n): n is string => !!n),
    emails,
    telefones,
    aniversario: d?.month && d.day ? { dia: d.day, mes: d.month, ...(d.year ? { ano: d.year } : {}) } : null,
    empresa: p.organizations?.[0]?.name?.trim() || null,
  };
}

/** Todos os contatos da conta, página a página, até `teto` (agenda gigante não trava o processo). */
export async function listarContatosGoogle(token: string, teto: number): Promise<ContatoAgenda[]> {
  const out: ContatoAgenda[] = [];
  let pageToken: string | undefined;
  do {
    const url =
      "https://people.googleapis.com/v1/people/me/connections?pageSize=1000&personFields=names,nicknames,emailAddresses,phoneNumbers,birthdays,organizations" +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "");
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`Google Contatos ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = (await res.json()) as Pagina;
    for (const p of j.connections ?? []) {
      const c = lerPessoa(p);
      if (c) out.push(c);
    }
    pageToken = j.nextPageToken;
  } while (pageToken && out.length < teto);
  return out.slice(0, teto);
}
