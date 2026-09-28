import { z } from "zod";
import { registerTools, type ToolDef } from "../registry";
import { importarReunioesOnline } from "../../meetings/online/importar";
import { settings } from "../../settings";

/**
 * Domínio: reuniões online (Meet, Teams, Zoom). O laço do processo vivo já
 * puxa as transcrições sozinho; esta tool é o "agora": o dono saiu da reunião
 * e não quer esperar a próxima volta.
 *
 * `escrita` e não `leitura`: ela cria resumo, documento e tarefas. Não é
 * `efeito_externo` porque nada sai de casa: é o mesmo que gravar a reunião.
 */

const Entrada = z.object({});

export const buscar_reunioes_online: ToolDef<typeof Entrada> = {
  name: "buscar_reunioes_online",
  domain: "reunioes",
  description:
    "Procura AGORA as transcrições novas das reuniões do Google Meet, Teams e Zoom e manda resumir (resumo, compromissos e tarefas chegam quando ficarem prontos). Use para 'resume a reunião do Meet que acabou', 'puxa a reunião do Teams de hoje'.",
  risk: "escrita",
  keywords: ["reuniao", "meet", "teams", "zoom", "transcricao", "resumo", "resumir", "call", "chamada"],
  inputSchema: Entrada,
  run: async (_i, { userId }) => {
    // Com prazo: uma reunião longa do Meet são dezenas de chamadas, e o turno
    // (e a voz) não pode ficar mudo esperando. Passou do prazo, a importação
    // continua sozinha e o resumo chega como aviso quando ficar pronto.
    const prazo = (await settings.get("meetings.importarEsperaMs").catch(() => 8000)) ?? 8000;
    const importacao = importarReunioesOnline(userId);
    const r = await Promise.race([importacao, new Promise<null>((ok) => setTimeout(() => ok(null), prazo).unref?.())]);
    if (!r) {
      void importacao.catch(() => undefined);
      return "Estou buscando as transcrições em segundo plano (demora um pouco). O resumo chega como aviso quando ficar pronto.";
    }
    if (!r.fontesLigadas) return "A busca de reuniões online está desligada. O dono liga em Ajustes, Reuniões (Meet, Teams ou Zoom).";
    const partes: string[] = [];
    if (r.importadas.length) partes.push(`Mandei resumir: ${r.importadas.join("; ")}. O resumo chega quando ficar pronto.`);
    if (r.curtas.length) partes.push(`Transcrição curta demais para resumir: ${r.curtas.join("; ")}.`);
    if (r.semPermissao.length)
      partes.push(`Sem permissão para ler as transcrições em: ${r.semPermissao.join("; ")}. O dono precisa reconectar a conta em Conectores (no Teams, também ligar a permissão de transcrição em Ajustes, Conectores).`);
    if (r.falhas.length) partes.push(`Não consegui consultar: ${[...new Set(r.falhas)].join("; ")}. Tento de novo na próxima volta.`);
    return partes.join(" ") || "Nenhuma transcrição nova de reunião online (Meet, Teams ou Zoom). Lembre que só existe transcrição quando ela foi ligada na reunião, e que a API entrega só as reuniões que o dono organizou.";
  },
};

registerTools([buscar_reunioes_online]);
