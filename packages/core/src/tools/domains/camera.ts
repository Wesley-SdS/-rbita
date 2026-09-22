import { z } from "zod";
import { findCamera, listCameras } from "../../cameras/query";
import { imagemFresca } from "../../cameras/fresca";
import { narrateSnapshot } from "../../cameras/narrate";
import { authorizeRoomForRequester } from "../../home/room-permission";
import { registerTools, type ToolContext, type ToolDef } from "../registry";

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
  // a Fase 2 trouxe permissão por cômodo e "câmera que identifica não vai para
  // a nuvem" (decisão 9.6). Esta tool é irmã de `ver_camera` e o modelo escolhe
  // entre as duas: sem as mesmas defesas aqui, a escolha dele viraria o buraco.
  authorize: async ({ local }: { local: string }, ctx: ToolContext) => {
    const cam = await findCamera(ctx.userId, local);
    if (!cam) return null; // câmera inexistente: a própria tool responde
    const quem = ctx.requester ? await ctx.requester().catch(() => null) : null;
    return authorizeRoomForRequester(cam.roomId, quem, "ver a câmera");
  },
  run: async ({ local }, { userId }) => {
    const cam = await findCamera(userId, local);
    if (!cam) return { erro: `Não achei uma câmera para "${local}".` };
    const ev = await imagemFresca(cam.id);
    // Sem imagem RECENTE a tool não desiste: ela PEDE. O chat transforma isto
    // num botão ("deixar ela olhar"), e o quadro é capturado na hora, em vez
    // de a Órbita descrever uma imagem de horas atrás como se fosse agora.
    if (!ev?.snapshot) return { precisa_de_imagem: true, camera_id: cam.id, camera: cam.name, motivo: `A câmera "${cam.name}" não tem imagem recente.` };
    const descricao = await narrateSnapshot(ev.snapshot, undefined, { localOnly: cam.identifyFaces });
    return { camera: cam.name, descricao, capturadoEm: ev.createdAt };
  },
};

registerTools([casa_listar_cameras, casa_ver_camera]);
