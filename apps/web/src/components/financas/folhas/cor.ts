import { PALETA } from "@orbita/core/finance/padroes";

/** Cor sorteada da paleta para cadastro novo (§7.13 a §7.15: "padrão aleatória"). */
export const corAleatoria = () => PALETA[Math.floor(Math.random() * PALETA.length)]!;
