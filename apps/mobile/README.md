# ÓRBITA — App Mobile (Expo)

App iOS/Android da ÓRBITA. Consome o **mesmo backend** do web (`apps/web`, porta 3000):
login/signup (Better Auth por cookie), chat com **streaming** (Qwen local), Orb animado.

Fora do workspace pnpm de propósito (o Metro não convive bem com os symlinks do pnpm);
tem `npm` próprio.

## Rodar

```bash
cd apps/mobile
npm install
npm start          # abre o Expo (QR code p/ Expo Go, ou i/a p/ simulador)
```

1. Suba o backend: na raiz, `docker compose up` (ou `pnpm --filter @orbita/web dev`).
2. No app, toque em **⚙ configurar servidor** e informe `http://IP-DO-SEU-PC:3000`
   (no celular físico, use o IP da máquina na rede — `localhost` não alcança o PC).
   No emulador/`--web`, o padrão já deriva o host do Metro.
3. Crie a conta / entre e converse.

## Estrutura

- `app/` — telas (Expo Router): `index` (login), `chat` (streaming + Orb), `settings`.
- `lib/api.ts` — client HTTP + sessão (cookie do Better Auth no SecureStore).
- `lib/auth.ts` / `lib/chat.ts` — auth e streaming de chat (`expo/fetch`).
- `components/Orb.tsx` — núcleo neural pulsante (versão leve, sem WebGL).
