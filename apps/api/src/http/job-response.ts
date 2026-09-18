import { settings } from "@orbita/core/settings/index";
import { toJobView } from "@orbita/core/jobs/registry";
import type { Job } from "@orbita/db/job-schema";

/**
 * Resposta de "trabalho aceito", no padrão Asynchronous Request-Reply
 * (Microsoft) e de operação longa do Google (AIP-151):
 *   - 202 Accepted, nunca 200: o trabalho ainda não foi feito;
 *   - `Location` aponta para o recurso de status;
 *   - `Retry-After` diz de quanto em quanto tempo vale perguntar.
 * Se a chave de dedup bateu (dois cliques no mesmo botão), a resposta é 200
 * com o trabalho que já existia, em vez de enfileirar um segundo.
 *
 * O corpo já é o próprio status, então a tela não precisa de um segundo pedido
 * para começar a mostrar o progresso.
 */
export async function jobAccepted(j: Job, jaExistia: boolean): Promise<Response> {
  const intervalo = await settings.get("jobs.pollSeconds").catch(() => 3);
  return Response.json(
    { ...toJobView(j), jaExistia },
    {
      status: jaExistia ? 200 : 202,
      headers: { Location: `/api/jobs/${j.id}`, "Retry-After": String(Math.max(1, Math.round(intervalo))) },
    },
  );
}

/** Status de um trabalho: 200 sempre (o estado vive no corpo), com dica de polling enquanto não terminou. */
export async function jobStatus(j: Job): Promise<Response> {
  const v = toJobView(j);
  const terminal = v.status === "feito" || v.status === "falhou" || v.status === "cancelado";
  const headers: Record<string, string> = {};
  if (!terminal) headers["Retry-After"] = String(Math.max(1, Math.round(await settings.get("jobs.pollSeconds").catch(() => 3))));
  return Response.json(v, { status: 200, headers });
}
