import { z } from "zod";
import { registerTools, type ToolDef, type ToolRisk } from "../registry";
import { settings } from "../../settings";
import { autorizarNaSessao } from "../../controle/sessao";
import { appNoEnvelope } from "../../controle/envelope";
import { chamarMaos, MaosError, maosDisponivel } from "../../maos/client";
import { expandirCaminho } from "../../maos/pastas";
import { CaminhoRecusado, conferirCaminho, regrasDeArquivo } from "../../arquivos-do-pc/guarda";
import { ACOES_DO_COMPUTADOR, recusaDoPasso, riscoDeAbrir, riscoDoLote, type ElementoVisto, type PassoParaRisco } from "../../computador/risco";
import { descreverAlvo, descreverFocado, janelasAbertas, mensagemDasMaos, nomesDoApp, ocultosDaConfig, sessaoDoComputador, temAlvo, type AlvoPedido } from "../../computador/servico";

/**
 * Domínio COMPUTADOR, a parte que AGE (PRD A7). Sensível pelo nome. A tarefa
 * delegada a um laço próprio (A8) ainda não existe: o modelo da conversa dirige
 * passo a passo com computador_ver e computador_agir.
 *
 * Toda ação aqui:
 *   1. precisa de sessão de controle ativa (o envelope aprovado), e do app no envelope;
 *   2. tem o alvo DESCRITO pelas mãos antes (a árvore de acessibilidade diz o
 *      que está naquele elemento ou ponto), e é esse alvo que decide o risco:
 *      "Enviar", "Pagar", "Excluir" e Enter num campo de conversa viram
 *      proposta, mesmo dentro da sessão;
 *   3. nunca digita em campo de senha, nunca toca app oculto nem janela de
 *      administrador (recusa, não risco a aprovar);
 *   4. leva a ASSINATURA do alvo até as mãos, que conferem de novo na hora:
 *      se a tela mudou entre propor e executar, nada é clicado;
 *   5. passa pelo crítico e grava passo (a guarda do registro faz isso).
 *
 * Rotina e regra não controlam a tela (PRD §3, "Sem supervisão"): recusado.
 */

const FIXO = "Preenchido pela Órbita. Deixe vazio.";
const NAO_EM_ROTINA = "Rotina e regra não controlam a tela do computador: só o dono pedindo, dentro de uma sessão.";
const disponivel = () => maosDisponivel();

const AlvoSchema = z.object({
  leitura: z.string().max(20).nullish().describe("A leitura de computador_ver."),
  elemento: z.number().int().min(1).max(100_000).nullish().describe("O número do elemento naquela leitura."),
  captura: z.string().max(20).nullish().describe("A captura de computador_ver (comImagem), para apontar por pixel."),
  x: z.number().min(0).max(20_000).nullish().describe("Pixel x NA IMAGEM da captura."),
  y: z.number().min(0).max(20_000).nullish().describe("Pixel y NA IMAGEM da captura."),
  marca: z.number().int().min(1).max(10_000).nullish().describe("A marca numerada da captura (com marcas)."),
  // o que as mãos viram no alvo: é isto que o crítico e a proposta leem, e o `preparar` sempre sobrescreve
  nome: z.string().max(400).nullish().describe(FIXO),
  papel: z.string().max(200).nullish().describe(FIXO),
});
const PassoSchema = z.object({
  acao: z.enum(ACOES_DO_COMPUTADOR).describe("clicar, clique_duplo, clique_direito, clique_meio, clique_triplo, digitar, tecla, atalho, rolar, arrastar, focar."),
  alvo: AlvoSchema.nullish().describe("Onde agir. Obrigatório para clicar, focar e arrastar; sem alvo, digitar e tecla vão para o que tem o foco."),
  destino: AlvoSchema.nullish().describe("Para arrastar: até onde."),
  texto: z.string().max(5000).nullish().describe("O texto a digitar."),
  tecla: z.string().max(60).nullish().describe('Tecla ou atalho: "Enter", "Tab", "ctrl+s", "alt+F4".'),
  direcao: z.enum(["cima", "baixo", "esquerda", "direita"]).nullish().describe("Para rolar."),
  quantidade: z.number().int().min(1).max(50).nullish().describe("Quanto rolar, ou quantas vezes apertar a tecla."),
  modificadores: z.string().max(40).nullish().describe('Teclas seguradas no clique: "ctrl", "shift".'),
});
type Passo = z.infer<typeof PassoSchema>;

const VistoSchema = z.object({
  papel: z.string().max(40),
  nome: z.string().max(200),
  assinatura: z.string().max(40),
  senha: z.boolean(),
  app: z.string().max(120),
  nomesDoApp: z.array(z.string().max(120)).max(20),
  oculto: z.boolean(),
  elevado: z.boolean(),
  janela: z.number(),
  ponto: z.tuple([z.number(), z.number()]).nullable(),
});
const PassoFixado = PassoSchema.extend({ visto: VistoSchema.nullable(), destinoVisto: VistoSchema.nullable(), focado: VistoSchema.nullable() });
type PassoFixado = z.infer<typeof PassoFixado>;

const AgirSchema = PassoSchema.partial({ acao: true }).extend({
  passos: z.array(PassoSchema).min(1).max(10).nullish().describe("Várias ações em ordem (clicar no campo, digitar, Enter). A primeira que falhar cancela as seguintes."),
  // o que o crítico e a proposta mostram vem daqui, fixado pela Órbita a partir do que as mãos viram
  app: z.string().max(120).nullish().describe(FIXO),
  fixado: z.object({ sessaoId: z.string().max(80), passos: z.array(PassoFixado).min(1).max(10), motivo: z.string().max(200).nullish() }).nullish().describe(FIXO),
});
type Agir = z.infer<typeof AgirSchema>;

/** Os passos pedidos: o lote, ou a ação solta. Puro. */
export function passosDoPedido(i: Agir): Passo[] {
  if (i.passos?.length) return i.passos;
  if (!i.acao) return [];
  return [{ acao: i.acao, alvo: i.alvo ?? null, destino: i.destino ?? null, texto: i.texto ?? null, tecla: i.tecla ?? null, direcao: i.direcao ?? null, quantidade: i.quantidade ?? null, modificadores: i.modificadores ?? null }];
}

const paraRisco = (p: PassoFixado): PassoParaRisco => ({ acao: p.acao, alvo: p.visto, destino: p.destinoVisto, focado: p.focado, texto: p.texto, tecla: p.tecla });

/**
 * Descreve cada alvo pelas mãos. Sem alvo, o que tem o foco; num lote, depois
 * de clicar num campo o foco é ESSE campo (e é nele que o "digitar" seguinte
 * cai), então ele vale como focado do passo seguinte.
 */
async function descreverPassos(passos: Passo[]): Promise<PassoFixado[]> {
  const out: PassoFixado[] = [];
  let focoAtual: ElementoVisto | null | undefined;
  for (const p of passos) {
    const visto = temAlvo(p.alvo) ? await descreverAlvo(p.alvo as AlvoPedido) : null;
    const destinoVisto = p.acao === "arrastar" && temAlvo(p.destino) ? await descreverAlvo(p.destino as AlvoPedido) : null;
    if (focoAtual === undefined && !visto) focoAtual = await descreverFocado();
    const focado = visto ?? focoAtual ?? null;
    out.push({ ...p, visto, destinoVisto, focado });
    if (visto && p.acao !== "rolar") focoAtual = visto;
  }
  return out;
}

const vistosNoAuthorize = new WeakMap<object, { sessaoId: string; passos: PassoFixado[] }>();

/**
 * O passo como as mãos executam: alvo pela leitura (com a assinatura), ou pelo
 * PIXEL FÍSICO que foi descrito. `porPonto` força o pixel: as mãos guardam só
 * as últimas leituras, e uma proposta que esperou aprovação pode chegar com a
 * dela já descartada. A assinatura vai junto e é ela que impede clicar em
 * outra coisa que esteja agora naquele ponto.
 */
function ordemDoPasso(p: PassoFixado, sessaoId: string, ocultos: string[], porPonto = false): Record<string, unknown> {
  const alvoFisico = (spec: Passo["alvo"], visto: ElementoVisto | null) => {
    if (!visto) return null;
    if (spec?.leitura && spec.elemento != null && !(porPonto && visto.ponto)) return { leitura: spec.leitura, elemento: spec.elemento };
    // a captura pode ter vencido entre a proposta e a aprovação: o ponto descrito é o que vale, com a assinatura conferida
    return visto.ponto ? { x: visto.ponto[0], y: visto.ponto[1] } : null;
  };
  return {
    sessaoId,
    acao: p.acao,
    alvo: alvoFisico(p.alvo, p.visto),
    destino: p.acao === "arrastar" ? alvoFisico(p.destino, p.destinoVisto) : null,
    assinatura: p.visto?.assinatura || null,
    texto: p.texto ?? null,
    tecla: p.tecla ?? null,
    direcao: p.direcao ?? null,
    quantidade: p.quantidade ?? null,
    modificadores: p.modificadores ?? null,
    ocultos,
  };
}

const descricao = (p: Pick<PassoFixado, "acao" | "visto" | "texto" | "tecla">) => {
  const onde = p.visto ? ` em ${p.visto.papel} "${p.visto.nome.slice(0, 60)}"` : "";
  const extra = p.acao === "digitar" ? `: "${String(p.texto ?? "").slice(0, 80)}"` : p.acao === "tecla" || p.acao === "atalho" ? `: ${p.tecla}` : "";
  return `${p.acao.replace("_", " ")}${onde}${extra}`;
};

export const computador_agir: ToolDef<typeof AgirSchema> = {
  name: "computador_agir",
  domain: "computador",
  description:
    "Age no Windows do dono dentro de uma sessão de controle aberta (controle_iniciar): clicar, digitar, apertar tecla ou atalho, rolar, arrastar, focar. O alvo é { leitura, elemento } de computador_ver, ou { captura, x, y } da imagem. Para várias ações seguidas, use passos (a primeira que falhar cancela o resto). Botões como enviar, pagar, excluir, e Enter num campo de conversa, viram proposta para o dono aprovar. Nunca digita senha.",
  risk: "escrita",
  keywords: ["clicar", "clica", "digitar", "digita", "escrever", "tecla", "atalho", "rolar", "arrastar", "botao", "campo", "janela", "computador", "windows"],
  requires: { available: disponivel },
  inputSchema: AgirSchema,
  async authorize(i, ctx) {
    if (ctx.origem) return NAO_EM_ROTINA;
    const passos = passosDoPedido(i);
    if (!passos.length) return "Diga a ação (acao) ou os passos.";
    // falha fechada: sem conseguir conferir a sessão, não age
    const sem = await autorizarNaSessao(ctx, { tipo: "computador" }).catch(() => "Não consegui conferir a sessão de controle agora.");
    if (sem) return sem;
    const sessao = await sessaoDoComputador(ctx.userId);
    if (!sessao) return "A sessão de controle do computador não está mais ativa.";
    let fixos: PassoFixado[];
    try {
      fixos = await descreverPassos(passos);
    } catch (e) {
      return mensagemDasMaos(e);
    }
    const recusados = await settings.get("computador.appsRecusados").catch(() => [] as string[]);
    for (const [k, p] of fixos.entries()) {
      const r = recusaDoPasso(paraRisco(p), sessao.apps, recusados);
      if (r) return passos.length > 1 ? `Passo ${k + 1}: ${r}` : r;
    }
    vistosNoAuthorize.set(i, { sessaoId: sessao.id, passos: fixos });
    return null;
  },
  async preparar(i, ctx) {
    const visto = vistosNoAuthorize.get(i);
    const passos = visto?.passos ?? (await descreverPassos(passosDoPedido(i)));
    const sessaoId = visto?.sessaoId ?? (await sessaoDoComputador(ctx.userId))?.id ?? "";
    // o motivo do risco vai fixado para o resumo da fila (que não lê config); o risco em si é recalculado no elevarRisco
    const rotulos = await settings.get("computador.rotulosDeEfeito").catch(() => [] as string[]);
    const motivo = riscoDoLote(passos.map(paraRisco), rotulos).motivo;
    const p0 = passos[0]!;
    const lote = passos.length > 1;
    // O crítico lê `acao`, `alvo.nome`/`alvo.papel`, `app` e `texto`. Tudo isso sai do que as MÃOS
    // viram, nunca do que o modelo escreveu: um rótulo inventado pelo modelo é sobrescrito aqui.
    // Num lote, os rótulos e as ações de todos os passos vão juntos, para o crítico ver o lote inteiro.
    const alvoDoCritico = {
      nome: passos.map((p) => (p.visto ?? p.focado)?.nome ?? "").filter(Boolean).join(" · ").slice(0, 400) || null,
      papel: passos.map((p) => `${p.acao}${(p.visto ?? p.focado) ? ` ${(p.visto ?? p.focado)!.papel}` : ""}`).join(" · ").slice(0, 200),
    };
    const limpar = ({ visto: _v, destinoVisto: _d, focado: _f, ...p }: PassoFixado): Passo => ({ ...p, alvo: p.alvo ? { ...p.alvo, nome: null, papel: null } : p.alvo });
    return {
      acao: lote ? undefined : p0.acao,
      alvo: { ...(lote ? {} : (p0.alvo ?? {})), ...alvoDoCritico },
      passos: passos.map(limpar),
      texto: passos.map((p) => p.texto ?? p.tecla ?? "").filter(Boolean).join(" | ").slice(0, 5000) || null,
      tecla: lote ? null : (p0.tecla ?? null),
      app: (p0.visto ?? p0.focado)?.app || null,
      fixado: { sessaoId, passos: passos.map((p) => ({ ...p, alvo: p.alvo ? { ...p.alvo, nome: null, papel: null } : p.alvo })), motivo },
    };
  },
  async elevarRisco(f) {
    if (!f.fixado?.passos.length) return "perigoso";
    const rotulos = await settings.get("computador.rotulosDeEfeito");
    return riscoDoLote(f.fixado.passos.map(paraRisco), rotulos).risco;
  },
  summarize: (f, risco) => {
    const ps = f.fixado?.passos ?? [];
    const app = f.app ? ` no ${f.app}` : "";
    const motivo = risco && risco !== "escrita" ? (f.fixado?.motivo ?? "ação que pede aprovação") : null;
    const corpo = ps.length > 1 ? `${ps.length} ações${app}: ${ps.map(descricao).join("; ")}` : `${ps[0] ? descricao(ps[0]) : "ação"}${app}`;
    return `${corpo.charAt(0).toUpperCase()}${corpo.slice(1)}${motivo ? ` (${motivo})` : ""}`;
  },
  async run(i, ctx) {
    const f = i.fixado;
    if (!f?.passos.length) return { erro: "Ação sem a conferência do alvo. Veja a janela de novo." };
    const [ocultos, pausa] = await Promise.all([ocultosDaConfig(), settings.get("computador.pausaEntrePassosMs").catch(() => 150)]);
    const feitos: string[] = [];
    for (const [k, p] of f.passos.entries()) {
      if (k > 0 && pausa) await new Promise((r) => setTimeout(r, pausa));
      try {
        // digitar texto longo leva tempo (uma tecla por caractere): o prazo acompanha o tamanho
        const prazo = 15_000 + (p.texto?.length ?? 0) * 20;
        const pedir = (porPonto: boolean) => chamarMaos<{ via: string }>("/computador/agir", { corpo: ordemDoPasso(p, f.sessaoId, ocultos, porPonto), timeoutMs: prazo });
        const r = await pedir(false).catch((e: unknown) => {
          if (e instanceof MaosError && e.recusada && /leitura da tela expirou/.test(e.message) && (p.visto?.ponto || p.destinoVisto?.ponto)) return pedir(true);
          throw e;
        });
        feitos.push(`${descricao(p)} (${r.via})`);
      } catch (e) {
        const motivo = mensagemDasMaos(e);
        const cancelados = f.passos.length - k - 1;
        const { resumoDoControle } = await import("../../controle/resumo");
        return {
          permitido: false,
          erro: `${f.passos.length > 1 ? `Passo ${k + 1} falhou` : "Não deu"}: ${motivo}${cancelados ? ` (${cancelados} passo${cancelados > 1 ? "s" : ""} seguinte${cancelados > 1 ? "s" : ""} cancelado${cancelados > 1 ? "s" : ""})` : ""}`,
          feitos,
          controle: await resumoDoControle(ctx.userId).catch(() => null),
        };
      }
    }
    return { mensagem: `Feito: ${feitos.join("; ")}.`, feitos: feitos.length };
  },
};

// ── computador_abrir ────────────────────────────────────────────────────────
const janelasNoAuthorize = new WeakMap<object, string[]>();
const AbrirSchema = z.object({
  tipo: z.enum(["app", "arquivo", "url", "janela"]).describe("app (pelo nome: \"Bloco de Notas\", \"code\", \"excel\"), arquivo (caminho completo, abre com o programa padrão), url (no navegador padrão) ou janela (traz para a frente uma janela já aberta de um app do envelope, pelo número de computador_ver acao janelas; use quando a ação for recusada porque outra janela está por cima)."),
  alvo: z.string().trim().min(1).max(2000).describe("O nome do app, o caminho do arquivo, o endereço ou o número da janela."),
  fixado: z
    .object({ sessaoId: z.string().max(80).nullable(), nomes: z.array(z.string().max(120)).max(30), apps: z.array(z.string().max(120)).max(40), sites: z.array(z.string().max(253)).max(40) })
    .nullish()
    .describe(FIXO),
});
type Abrir = z.infer<typeof AbrirSchema>;

function riscoDoAbrir(i: Abrir): { risco: ToolRisk; motivo: string | null } {
  const f = i.fixado;
  if (!f) return { risco: "perigoso", motivo: "sem conferência" };
  const env = f.sessaoId ? { apps: f.apps, sites: f.sites } : null;
  // janela: só a de um app do envelope (o authorize já recusou as outras); fora dele, nunca libera sozinha
  if (i.tipo === "janela") return env && f.nomes.some((n) => appNoEnvelope(n, env.apps)) ? { risco: "escrita", motivo: null } : { risco: "perigoso", motivo: "janela fora do envelope" };
  // app: qualquer nome dele (executável, apelido) que esteja no envelope
  if (i.tipo === "app" && env && f.nomes.some((n) => appNoEnvelope(n, env.apps))) return { risco: "escrita", motivo: null };
  return riscoDeAbrir({ tipo: i.tipo, alvo: i.alvo }, env);
}

export const computador_abrir: ToolDef<typeof AbrirSchema> = {
  name: "computador_abrir",
  domain: "computador",
  description:
    "Abre um app (pelo nome), um arquivo (com o programa padrão) ou um endereço (no navegador padrão) no computador do dono, ou traz para a frente uma janela aberta de um app do envelope (tipo janela). App do envelope da sessão abre direto; fora dele, arquivo e endereço com parâmetros viram proposta para o dono aprovar. Programa e script nunca são abertos.",
  risk: "escrita",
  keywords: ["abrir", "abre", "iniciar", "app", "programa", "arquivo", "pasta", "site", "vscode", "excel", "bloco de notas"],
  requires: { available: disponivel },
  inputSchema: AbrirSchema,
  async authorize(i, ctx) {
    if (ctx.origem) return NAO_EM_ROTINA;
    if (i.tipo === "url" && !/^https?:\/\/\S+$/i.test(i.alvo)) return "Só abro endereço http ou https.";
    if (i.tipo === "app") {
      const [nomes, recusados] = await Promise.all([nomesDoApp(i.alvo), settings.get("computador.appsRecusados").catch(() => [] as string[])]);
      if (nomes.some((n) => appNoEnvelope(n, recusados))) return `O app "${i.alvo}" está na lista de apps que a Órbita não toca na tela (computador.appsRecusados). Para o Chrome, o caminho é navegador_tarefa.`;
    }
    if (i.tipo === "janela") {
      if (!/^\d{1,12}$/.test(i.alvo)) return "Diga o número da janela (de computador_ver com acao janelas).";
      const sem = await autorizarNaSessao(ctx, { tipo: "computador" }).catch(() => "Não consegui conferir a sessão de controle agora.");
      if (sem) return sem;
      const sessao = await sessaoDoComputador(ctx.userId);
      let js: Awaited<ReturnType<typeof janelasAbertas>>;
      try {
        js = await janelasAbertas();
      } catch (e) {
        return mensagemDasMaos(e);
      }
      const j = js.find((x) => x.janela === Number(i.alvo));
      if (!j || j.oculta) return "Essa janela não está aberta (ou é de um app oculto). Veja as janelas de novo.";
      // trazer para a frente uma janela fora do envelope não é risco a aprovar: é recusa, como agir nela
      const apps = sessao?.apps ?? [];
      if (!j.nomes.some((n) => appNoEnvelope(n, apps))) return `O app "${j.app || j.exe}" não está no envelope aprovado (${apps.join(", ") || "nenhum app"}). Para usá-lo, proponha um envelope novo.`;
      janelasNoAuthorize.set(i, j.nomes);
    }
    if (i.tipo === "arquivo") {
      try {
        await conferirCaminho(i.alvo);
      } catch (e) {
        if (e instanceof CaminhoRecusado) return e.message;
        throw e;
      }
    }
    return null;
  },
  async preparar(i, ctx) {
    const sessao = await sessaoDoComputador(ctx.userId);
    const alvo = i.tipo === "arquivo" ? (await conferirCaminho(i.alvo)).real : i.alvo;
    const nomes = i.tipo === "app" ? await nomesDoApp(i.alvo) : i.tipo === "janela" ? (janelasNoAuthorize.get(i) ?? []) : [];
    return { tipo: i.tipo, alvo, fixado: { sessaoId: sessao?.id ?? null, nomes, apps: sessao?.apps ?? [], sites: sessao?.sites ?? [] } };
  },
  async elevarRisco(f) {
    return riscoDoAbrir(f).risco;
  },
  summarize: (f, risco) => {
    const m = riscoDoAbrir(f).motivo;
    const o = f.tipo === "app" ? `Abrir o app ${f.alvo}` : f.tipo === "arquivo" ? `Abrir o arquivo ${f.alvo}` : f.tipo === "janela" ? `Trazer para a frente a janela ${f.alvo}` : `Abrir no navegador: ${f.alvo}`;
    return risco && risco !== "escrita" && m ? `${o} (${m})` : o;
  },
  async run(i) {
    // risco que pedia aprovação e chegou aqui: foi aprovado na fila (as mãos aceitam fora do envelope só assim)
    const aprovada = riscoDoAbrir(i).risco !== "escrita";
    try {
      if (i.tipo === "janela") {
        const r = await chamarMaos<{ em_foco: boolean; app: string }>("/computador/janela/frente", { corpo: { sessaoId: i.fixado?.sessaoId ?? null, janela: Number(i.alvo), ocultos: await ocultosDaConfig() } });
        return { ...r, mensagem: r.em_foco ? `A janela de ${r.app} está na frente.` : `Pedi a janela de ${r.app} na frente, mas o Windows não deu o foco a ela (o dono está usando outra janela).` };
      }
      const raizes = i.tipo === "arquivo" ? (await regrasDeArquivo()).pastas.map((p) => expandirCaminho(p)) : [];
      const r = await chamarMaos<Record<string, unknown>>("/computador/abrir", { corpo: { tipo: i.tipo, alvo: i.alvo, sessaoId: i.fixado?.sessaoId ?? null, aprovada, raizes } });
      return { ...r, mensagem: i.tipo === "app" ? `Abri ${i.alvo}.` : i.tipo === "arquivo" ? `Abri ${i.alvo} com o programa padrão.` : `Abri ${i.alvo} no navegador.` };
    } catch (e) {
      return { erro: mensagemDasMaos(e) };
    }
  },
};

registerTools([computador_agir, computador_abrir]);
