"use client";

/* GERADO por `scripts/portar-presenca.py` a partir de
   `prototypes/orbita-presenca/app.js`. NÃO EDITE À MÃO: rode o script.

   Traçado de 1,65 sobre grade de 24, sem preenchimento: é o que dá a eles o
   mesmo peso da tipografia. Foram desenhados à mão no protótipo, então não
   entra dependência nova nem fonte de ícone para carregar. */

/* O mapa é conteúdo estático deste arquivo, nunca entrada de usuário, então
   injetar como markup é seguro e poupa reescrever dezenas de ícones em JSX. */
const TRACOS: Record<string, string> = {
  orbit: `<circle cx="12" cy="12" r="5"/><ellipse cx="12" cy="12" rx="11" ry="5" transform="rotate(-35 12 12)"/>`,
  home: `<path d="m3 10 9-7 9 7v10H3Z"/><path d="M9 20v-7h6v7"/>`,
  search: `<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>`,
  chat: `<path d="M20 11a8 8 0 0 1-8 8H5l-3 3V11a9 9 0 0 1 18 0Z"/><path d="M7 10h8M7 14h5"/>`,
  network: `<circle cx="12" cy="12" r="3"/><circle cx="5" cy="5" r="2"/><circle cx="19" cy="5" r="2"/><circle cx="5" cy="19" r="2"/><circle cx="19" cy="19" r="2"/><path d="m7 7 3 3m4 4 3 3M14 10l3-3M7 17l3-3"/>`,
  flow: `<rect x="3" y="3" width="6" height="6" rx="1.5"/><rect x="15" y="15" width="6" height="6" rx="1.5"/><path d="M6 9v7a2 2 0 0 0 2 2h7M15 6h5m-2-2 2 2-2 2"/>`,
  wave: `<path d="M3 10v4m4-8v12m5-16v20m5-16v12m4-8v4"/>`,
  wallet: `<path d="M20 8V5H5a2 2 0 0 0 0 4h16v11H5a2 2 0 0 1-2-2V7"/><path d="M21 12h-5v5h5M17 14.5h.5"/>`,
  plug: `<path d="m8 8 8 8M5 11l6-6 8 8-6 6a5.5 5.5 0 0 1-8-8ZM14 6l3-3m1 7 3-3M6 18l-3 3"/>`,
  spark: `<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5ZM20 2v4m-2-2h4"/>`,
  sliders: `<path d="M4 6h7m4 0h5M4 12h2m4 0h10M4 18h10m4 0h2"/><circle cx="13" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="18" r="2"/>`,
  settings: `<path d="m9 3-1 3-3 1-2 4 2 2v3l3 2 2 3h4l2-3 3-2v-3l2-2-2-4-3-1-1-3Z"/><circle cx="12" cy="12" r="3"/>`,
  chevrons: `<path d="m8 9 4-4 4 4m-8 6 4 4 4-4"/>`,
  'arrow-up-right': `<path d="M6 18 18 6M6 6h12v12"/>`,
  'arrow-right': `<path d="M4 12h16m-6-6 6 6-6 6"/>`,
  shield: `<path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6Z"/><path d="m8 12 3 3 5-6"/>`,
  sun: `<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>`,
  moon: `<path d="M20.8 13.3A9 9 0 0 1 10.7 3.2 9 9 0 1 0 20.8 13.3Z"/>`,
  bell: `<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>`,
  expand: `<path d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5"/>`,
  mic: `<rect x="9" y="2" width="6" height="13" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/>`,
  keyboard: `<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.1M10 9h.1M14 9h.1M18 9h.1M6 12h.1M10 12h.1M14 12h.1M18 12h.1M8 16h8"/>`,
  close: `<path d="m6 6 12 12M6 18 18 6"/>`,
  menu: `<path d="M4 6h16M4 12h16M4 18h16"/>`,
  info: `<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>`,
  check: `<path d="m5 12 4 4L19 6"/>`,
  play: `<path d="m8 4 12 8-12 8Z"/>`,
  pause: `<path d="M8 5v14M16 5v14"/>`,
  refresh: `<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6 6a8 8 0 0 1 13 3M5 15a8 8 0 0 0 13 3"/>`,
  plus: `<path d="M12 4v16M4 12h16"/>`,
  send: `<path d="m4 4 17 8-17 8 3-8Zm3 8h14"/>`,
  stop: `<rect x="5" y="5" width="14" height="14" rx="2"/>`,
  file: `<path d="M14 2H5v20h14V7Zm0 0v5h5M8 12h8m-8 4h6"/>`,
  clock: `<circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/>`,
  calendar: `<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6m10-6v6M3 11h18m-14 4h2m4 0h2"/>`,
  mail: `<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m3 5 9 8 9-8"/>`,
  light: `<path d="M9 18h6m-6 3h6M8 14a6 6 0 1 1 8 0c-1 1-1 3-1 3H9s0-2-1-3Z"/>`,
  temperature: `<path d="M9 15V5a3 3 0 0 1 6 0v10a5 5 0 1 1-6 0ZM12 9v9"/>`,
  lock: `<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4m-4 5v2"/>`,
  music: `<path d="M9 18V5l12-2v13M9 8l12-2"/><ellipse cx="6" cy="18" rx="3" ry="3"/><ellipse cx="18" cy="16" rx="3" ry="3"/>`,
  volume: `<path d="M4 9h4l5-5v16l-5-5H4Zm12-1a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>`,
  trash: `<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>`,
  download: `<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>`,
  leaf: `<path d="M20 3C5 2 1 9 5 16s16 7 15-13ZM5 20 16 9"/>`,
  link: `<path d="m10 14 4-4M8 16l-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m2 1 2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0"/>`,
};

export function Icone({ nome, className = "" }: { nome: string; className?: string }) {
  return (
    <svg
      className={`icon ${className}`.trim()}
      viewBox="0 0 24 24"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: TRACOS[nome] ?? TRACOS.spark! }}
    />
  );
}
