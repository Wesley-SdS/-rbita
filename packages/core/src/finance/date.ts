/**
 * Parse de data de lançamento financeiro sem cair um dia por timezone.
 * Aceita "YYYY-MM-DD" e "DD/MM/YYYY" (formatos comuns em cupons/extratos BR).
 * Ancora ao meio-dia local para nunca cruzar a fronteira do dia por UTC.
 */
export function parseYmd(value: string | null | undefined): Date | null {
  if (!value) return null;
  const s = value.trim();
  let y: number, m: number, d: number;

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (iso) {
    y = +iso[1]; m = +iso[2]; d = +iso[3];
  } else if (br) {
    d = +br[1]; m = +br[2]; y = +br[3];
  } else {
    return null;
  }
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, m - 1, d, 12, 0, 0, 0);
  return isNaN(dt.getTime()) ? null : dt;
}
