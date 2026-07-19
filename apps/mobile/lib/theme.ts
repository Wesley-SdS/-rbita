/**
 * Tema compartilhado com o web — MESMOS valores de `apps/web/src/app/globals.css`
 * para a identidade visual ser idêntica nas duas plataformas.
 */
export const theme = {
  ground: "#0b0805",
  surface: "#15100a",
  line: "#33281a",
  ink: "#f3ecdd",
  inkDim: "#b8a98d",
  gold: "#f5b544",
  amber: "#e89a3c",
  danger: "#e0705a",
  good: "#8ac98f",
  onGold: "#241403", // texto sobre o dourado
} as const;

/** Fundo do app: mesmo gradiente radial do web (body em globals.css / Orb). */
export const GROUND_GRADIENT = "radial-gradient(circle at 50% 30%, #1a1206 0%, #0d0904 55%, #0a0703 100%)";
