import { installBiometricEgressGuard } from "@orbita/core/privacy/egress";

/**
 * Importado logo depois de ./env e ANTES de todo o resto em main.ts: um módulo
 * que guardasse `globalThis.fetch` numa variável ao carregar escaparia do guard
 * se ele fosse instalado depois. Biometria nunca sai de casa (PRD §4.1).
 * `console.error` e não o logger: o logger ainda nem foi carregado aqui.
 */
installBiometricEgressGuard((host) => {
  console.error(JSON.stringify({ level: "error", msg: "privacy.biometria_bloqueada", host, ts: new Date().toISOString() }));
});
