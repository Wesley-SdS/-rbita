import { z } from "zod";
import { findCamera, latestEventWithSnapshot, listCameras } from "../../cameras/query";
import { narrateSnapshot } from "../../cameras/narrate";
import { registerTools, type ToolDef } from "../registry";

/** Domínio: câmeras da casa (Onda 5). Só leitura: ver e listar, nunca controla nada. */

export const casa_listar_cameras: ToolDef<z.ZodObject<Record<string, never>>> = {
  name: "casa_listar_cameras",
  domain: "camera",
  description: "Lista as câmeras cadastradas na casa, o cômodo de cada uma e se estão ligadas.",
  risk: "leitura",
  keywords: ["câmera", "camera", "vigilância", "cameras cadastradas"],
  inputSchema: z.object({}),
  run: async (_input, { userId }) => {
    const cams = await listCameras(userId);
    if (cams.length === 0) return { cameras: [], aviso: "Nenhuma câmera cadastrada ainda." };
    return { cameras: cams.map((c) => ({ nome: c.name, ligada: c.enabled })) };
  },
};

const VerInput = z.object({ local: z.string().describe("nome da câmera ou do cômodo, ex: 'sala', 'câmera da garagem'") });
export const casa_ver_camera: ToolDef<typeof VerInput> = {
  name: "casa_ver_camera",
  domain: "camera",
  description:
    "Descreve o que a câmera de um cômodo está vendo, a partir da última imagem capturada. Narração é sob demanda: só roda quando esta tool é chamada, nunca em toda detecção (custo e privacidade).",
  risk: "leitura",
  keywords: ["câmera", "camera", "o que está acontecendo", "sala", "quintal", "garagem", "ver", "vendo"],
  inputSchema: VerInput,
  run: async ({ local }, { userId }) => {
    const cam = await findCamera(userId, local);
    if (!cam) return { erro: `Não achei uma câmera para "${local}".` };
    const ev = await latestEventWithSnapshot(cam.id);
    if (!ev?.snapshot) return { erro: `A câmera "${cam.name}" ainda não tem nenhuma imagem recente para descrever.` };
    const descricao = await narrateSnapshot(ev.snapshot);
    return { camera: cam.name, descricao, capturadoEm: ev.createdAt };
  },
};

registerTools([casa_listar_cameras, casa_ver_camera]);
