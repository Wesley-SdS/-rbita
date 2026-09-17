/**
 * Permissão por PESSOA e por CÔMODO (B7.1). Não é multi-tenant (CLAUDE.md
 * §1): todas as pessoas pertencem à mesma casa/conta; isto decide quem pode
 * agir em qual cômodo, não isola dado entre organizações.
 *
 * Parte PURA, sem banco: `packages/core/src/home/access.ts` busca os dados e
 * chama isto. Hoje o chat web só tem UMA identidade (a conta Better Auth do
 * dono) — não existe ainda um sinal de "quem está falando" vindo de voz ou
 * dispositivo (isso é da Onda 6, B5.3/B5.4). Por isso o caminho do chat trata
 * quem chama como "dono" (acesso total) até essa identidade existir; a regra
 * abaixo já fica pronta para quando um `personId` real chegar.
 */
export type HomeRole = "dono" | "morador" | "visitante";

export interface RoomAccessEntry {
  roomId: string;
  allowed: boolean;
}

/**
 * `roomId` nulo = entidade sem cômodo associado ainda (comum logo após o
 * sync). Regra: dono sempre pode; acesso explícito (liberado ou negado)
 * sempre vence; sem entrada explícita, morador pode e visitante não pode —
 * visitante começa restrito, o dono libera cômodo a cômodo.
 */
export function canAccessRoom(role: HomeRole, roomId: string | null, explicitAccess: readonly RoomAccessEntry[]): boolean {
  if (role === "dono") return true;
  const explicit = roomId ? explicitAccess.find((e) => e.roomId === roomId) : undefined;
  if (explicit) return explicit.allowed;
  return role === "morador";
}
