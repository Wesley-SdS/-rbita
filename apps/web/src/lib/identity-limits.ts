/**
 * Limites de gravação que o servidor define em `setting` (com tela). O front
 * NÃO pode repetir esses números: subir "fala mínima no cadastro" na tela e o
 * navegador continuar gravando 45 s faria todo cadastro falhar sem explicação.
 * Busca uma vez por sessão; se a rota falhar, vale o default (o mesmo do
 * servidor), e o pior caso é o comportamento antigo.
 */
export interface IdentityLimits {
  clipMaxKB: number;
  clipSegundos: number;
  cadastroVozSegundos: number;
  falaMinimaSegundos: number;
  testeVozSegundos: number;
  audioMaxMb: number;
  fotoMaxMb: number;
}

export const LIMITES_PADRAO: IdentityLimits = {
  clipMaxKB: 400,
  clipSegundos: 6,
  cadastroVozSegundos: 45,
  falaMinimaSegundos: 20,
  testeVozSegundos: 4,
  audioMaxMb: 10,
  fotoMaxMb: 8,
};

let cache: Promise<IdentityLimits> | null = null;

export function identityLimits(): Promise<IdentityLimits> {
  cache ??= fetch("/api/identity/limits")
    .then((r) => (r.ok ? r.json() : Promise.reject()))
    .then((d: Partial<IdentityLimits>) => ({ ...LIMITES_PADRAO, ...d }))
    .catch(() => LIMITES_PADRAO);
  return cache;
}
