import { settings } from "../settings";
import { isOwner } from "../owner";
import { log } from "../observability/logger";
import type { ChamadaSensivel, GuardaSensivel } from "../tools/registry";
import { criticar, metadadosDaAcao, type Gerador } from "./critico";
import { tipoDeAlvoDoDominio, type TipoDeAlvo } from "./dominios";
import { appNoEnvelope, conferirSessao, normalizarSite, siteNoEnvelope } from "./envelope";
import { contarPasso, pausarSessao, registrarVeredito, sessaoParaTipo } from "./sessao";
import { atualizarPasso, miniaturaDaSaida, passoDaProposta, registrarPasso, resumoDoResultado } from "./trilha";

/**
 * A GUARDA das tools sensíveis (PRD F1 a F4), aplicada pelo REGISTRO a toda
 * tool de controle, terminal, arquivos, computador e navegador. Nenhuma tool
 * precisa lembrar de nada disto, e por isso uma tool nova nasce com trilha,
 * sessão e crítico:
 *
 *   1. controle ligado e quem pede é o dono da instância (a conta, não só a voz);
 *   2. o passo é gravado ANTES (`executando`), ou o passo que esperava na fila
 *      é retomado, para a trilha mostrar uma linha por ação;
 *   3. `escrita` de computador e navegador sem aprovação humana exige sessão
 *      ativa (a tool que age sem sessão declara `semSessao`), e o app ou o
 *      site que a entrada fixada vai tocar tem de estar no envelope;
 *   4. o crítico confere essa mesma `escrita` contra o pedido do dono: veto não
 *      executa, e vetos seguidos pausam a sessão e avisam;
 *   5. o passo conta no teto da sessão, de forma atômica;
 *   6. executa e atualiza o passo (executado ou falhou), com a miniatura só se
 *      o dono deixou guardar.
 *
 * Ação que o dono APROVOU na fila (`acaoId`) não passa pelo crítico nem pelo
 * teto: ela já teve o humano, que é mais forte que os dois.
 */

type Objeto = Record<string, unknown>;
const objeto = (v: unknown): Objeto | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Objeto) : null);
const textos = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && !!x.trim()) : []);

/**
 * O que a ação vai TOCAR, tirado da entrada já fixada pelo `preparar`: cada
 * app (com os apelidos que as mãos viram: "Bloco de Notas" é também
 * "notepad") e cada endereço. É o que deixa o backstop da guarda conferir o
 * envelope sem depender do `authorize` da tool (I12 da auditoria). Puro.
 */
export function alvosDaAcao(entrada: unknown): { apps: string[][]; urls: string[] } {
  const e = objeto(entrada) ?? {};
  const f = objeto(e.fixado) ?? {};
  const apps: string[][] = [];
  const doElemento = (v: unknown) => {
    const o = objeto(v);
    if (!o) return;
    const nomes = [...(typeof o.app === "string" && o.app.trim() ? [o.app] : []), ...textos(o.nomesDoApp), ...textos(o.nomes_do_app)];
    if (nomes.length) apps.push(nomes);
  };
  // computador_agir: cada passo, o alvo visto (ou o que tem o foco) e o destino do arrastar
  for (const p of Array.isArray(f.passos) ? f.passos : []) {
    const passo = objeto(p);
    if (!passo) continue;
    if (passo.visto) doElemento(passo.visto);
    else doElemento(passo.focado);
    doElemento(passo.destinoVisto);
  }
  // computador_abrir: os nomes do app (ou da janela) que o preparar resolveu
  if (textos(f.nomes).length) apps.push([...textos(f.nomes), ...(e.tipo === "app" && typeof e.alvo === "string" ? [e.alvo] : [])]);
  // tool que não fixa nada: o app que a entrada declara
  if (!apps.length) {
    const declarado = [e.app, objeto(e.alvo)?.app].filter((x): x is string => typeof x === "string" && !!x.trim());
    if (declarado.length) apps.push(declarado);
  }
  const urls = [e.url, f.url, objeto(e.alvo)?.url, e.tipo === "url" ? e.alvo : undefined].filter((x): x is string => typeof x === "string" && !!x.trim());
  return { apps, urls };
}

/**
 * A ação cabe no envelope? App de computador fora dele, ou site fora dele (no
 * navegador, a não ser que o dono tenha posto o site em modo escrita, que é o
 * que o risco do Chrome já aceita), devolve a frase de recusa. Sem nada
 * identificável na entrada, fica a conferência de tipo, tempo e teto.
 */
async function foraDoEnvelope(userId: string, tipo: TipoDeAlvo, sessao: { apps: readonly string[]; sites: readonly string[] }, entrada: unknown): Promise<string | null> {
  const { apps, urls } = alvosDaAcao(entrada);
  if (tipo === "computador") {
    for (const nomes of apps) {
      if (!nomes.some((n) => appNoEnvelope(n, sessao.apps))) return `O app "${nomes[0]}" não está no envelope aprovado (${sessao.apps.join(", ") || "nenhum app"}). Para usá-lo, proponha um envelope novo.`;
    }
  }
  for (const url of urls) {
    const site = normalizarSite(url);
    if (!site || siteNoEnvelope(site, sessao.sites)) continue;
    if (tipo === "navegador") {
      const { decidirSite, regrasDeSite } = await import("../navegador/sites");
      if (decidirSite(url, await regrasDeSite(userId)).modo === "escrita") continue;
    }
    return `O site "${site}" não está no envelope aprovado (${sessao.sites.join(", ") || "nenhum site"}). Para usá-lo, proponha um envelope novo.`;
  }
  return null;
}

/** A guarda com o crítico de verdade; o teste injeta outro gerador. */
export function criarGuarda(gerador?: Gerador): GuardaSensivel {
  async function recusar(c: ChamadaSensivel, motivo: string, sessaoId: string | null, passoId?: string): Promise<{ permitido: false; erro: string }> {
    if (passoId) await atualizarPasso(passoId, { decisao: "recusado", resultado: motivo, sessaoId });
    else await registrarPasso({ userId: c.ctx.userId, tool: c.def.name, risco: c.risco, decisao: "recusado", entrada: c.entrada, sessaoId, acaoId: c.acaoId, canal: c.ctx.canal, resultado: motivo });
    return { permitido: false, erro: motivo };
  }

  return {
    async recusada(c) {
      // a recusa entra na trilha DA SESSÃO, quando há uma: "tentou o Excel e foi barrada" é parte da história dela
      const tipo = tipoDeAlvoDoDominio(c.def.domain);
      const sessao = tipo ? await sessaoParaTipo(c.ctx.userId, tipo).catch(() => null) : null;
      await registrarPasso({ userId: c.ctx.userId, tool: c.def.name, risco: c.risco, decisao: "recusado", entrada: c.entrada, sessaoId: sessao?.id ?? null, canal: c.ctx.canal, resultado: c.motivo }).catch((e) =>
        log.warn("controle.trilha_falhou", { tool: c.def.name, erro: e instanceof Error ? e.message : String(e) }),
      );
    },

    async enfileirada(c) {
      const tipo = tipoDeAlvoDoDominio(c.def.domain);
      const sessao = tipo ? await sessaoParaTipo(c.ctx.userId, tipo) : null;
      await registrarPasso({ userId: c.ctx.userId, tool: c.def.name, risco: c.risco, decisao: "na_fila", entrada: c.entrada, sessaoId: sessao?.id ?? null, acaoId: c.acaoId, canal: c.ctx.canal });
    },

    async executar(c) {
      const userId = c.ctx.userId;
      const cfg = await settings.getMany(["controle.ativo", "controle.guardarMiniaturas", "controle.criticoTextoMax", "controle.vetosParaPausar"]);
      if (!cfg["controle.ativo"]) return recusar(c, "O controle do PC está desligado em Ajustes (Controle do PC).", null);
      if (!(await isOwner(userId))) return recusar(c, "Só o dono desta Órbita pode usar o controle do PC.", null);

      const tipo = tipoDeAlvoDoDominio(c.def.domain);
      // Rotina e regra (ninguém olhando) só LEEM a tela e o navegador. Isto vale para toda tool de
      // computador e navegador, sem depender do `authorize` de cada uma lembrar de recusar (O3 da
      // revisão). Mídia e volume (`semSessao`) continuam: tocar a playlist às 7h não mexe na tela.
      if (c.ctx.origem && tipo && c.risco !== "leitura" && !(tipo === "computador" && c.def.semSessao)) {
        return recusar(c, "Rotina e regra só leem a tela e o navegador. Agir neles é só com o dono pedindo, dentro de uma sessão de controle.", null);
      }
      const sessao = tipo ? await sessaoParaTipo(userId, tipo) : null;
      const naFila = c.acaoId ? await passoDaProposta(userId, c.acaoId) : null;
      let passoId: string;
      if (naFila) {
        passoId = naFila.id;
        await atualizarPasso(passoId, { decisao: "executando", sessaoId: naFila.sessaoId ?? sessao?.id ?? null });
      } else {
        passoId = await registrarPasso({ userId, tool: c.def.name, risco: c.risco, decisao: "executando", entrada: c.entrada, sessaoId: sessao?.id ?? null, acaoId: c.acaoId, canal: c.ctx.canal });
      }

      const precisaDeSessao = tipo !== null && c.risco === "escrita" && !c.def.semSessao && !c.acaoId;
      if (precisaDeSessao) {
        // o `authorize` da tool já devia ter recusado; isto é a trava que não depende dele
        const conf = conferirSessao(sessao ? { ...sessao, alvo: sessao.alvo as "computador" | "navegador" | "ambos" } : null, { tipo: tipo! });
        if (!conf.ok) {
          if (conf.pausar && sessao) await pausarSessao(userId, sessao.id, conf.pausar);
          return recusar(c, conf.motivo, sessao?.id ?? null, passoId);
        }
        // e o ALVO (app, site) cabe no envelope: uma tool nova que esqueça o `autorizarNaSessao` não age em qualquer app
        const fora = await foraDoEnvelope(userId, tipo!, sessao!, c.entrada).catch(() => "Não consegui conferir o envelope da sessão agora.");
        if (fora) return recusar(c, fora, sessao!.id, passoId);

        const veredito = await criticar(
          userId,
          { pedidoOriginal: sessao!.pedidoOriginal, pedidoLiteral: sessao!.pedidoLiteral, objetivo: sessao!.objetivo, acao: metadadosDaAcao(c.def.name, c.entrada, cfg["controle.criticoTextoMax"]) },
          gerador,
        );
        if (!veredito.alinhado) {
          await atualizarPasso(passoId, { decisao: "vetado", resultado: veredito.motivo, sessaoId: sessao!.id });
          // falha do crítico não é veto dele: bloqueia, mas não conta para pausar
          if (!veredito.falhou) {
            const seguidos = await registrarVeredito(userId, sessao!.id, false);
            if (seguidos >= cfg["controle.vetosParaPausar"]) {
              await pausarSessao(userId, sessao!.id, `${seguidos} vetos seguidos do crítico`);
              const { notifyUser } = await import("../routines/run");
              await notifyUser(userId, "A Órbita pausou o controle do PC", `O crítico vetou ${seguidos} ações seguidas em "${sessao!.objetivo}". Último motivo: ${veredito.motivo}`, null, { origem: "sistema", whatsapp: true }).catch(() => undefined);
            }
          }
          return { permitido: false, vetado: true, motivo: veredito.motivo };
        }
        if (!veredito.falhou) await registrarVeredito(userId, sessao!.id, true);

        if (!(await contarPasso(userId, sessao!.id))) {
          await pausarSessao(userId, sessao!.id, "teto de passos");
          return recusar(c, `A sessão chegou ao teto de ${sessao!.tetoPassos} passos. Para continuar, proponha um envelope novo.`, sessao!.id, passoId);
        }
      }

      const comecou = Date.now();
      try {
        const r = await c.run();
        await atualizarPasso(passoId, { decisao: "executado", resultado: resumoDoResultado(r), duracaoMs: Date.now() - comecou, miniatura: miniaturaDaSaida(r, cfg["controle.guardarMiniaturas"]) });
        return r;
      } catch (e) {
        await atualizarPasso(passoId, { decisao: "falhou", resultado: e instanceof Error ? e.message : String(e), duracaoMs: Date.now() - comecou }).catch(() => undefined);
        throw e;
      }
    },
  };
}

/** A guarda que o registro usa em produção. */
export const guardaDoControle: GuardaSensivel = criarGuarda();
