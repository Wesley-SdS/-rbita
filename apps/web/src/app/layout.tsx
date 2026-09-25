import type { Metadata, Viewport } from "next";
import "./globals.css";
import { cookies } from "next/headers";
import { PWARegister } from "@/components/pwa-register";
import { atributosDoHtml, COOKIE_LATERAL, COOKIE_TEMA } from "@/lib/preferencias-visuais";

export const metadata: Metadata = {
  title: "ÓRBITA — Assistente Pessoal",
  description: "Seu assistente pessoal de IA, local-first.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "ÓRBITA" },
  icons: {
    icon: [
      { url: "/icone.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/icon-192.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#f6f7f2",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // O tema vem do COOKIE e sai já no HTML. Antes era um `<script>` no `<head>`
  // lendo `localStorage`, que o React 19 passa a acusar no console, e a saída
  // do `next/script` foi medida pondo o script DEPOIS do `<body>`, o que traria
  // o flash de volta. Ver `lib/preferencias-visuais.ts`.
  const jar = await cookies();
  const atributos = atributosDoHtml(jar.get(COOKIE_TEMA)?.value, jar.get(COOKIE_LATERAL)?.value);

  return (
    // sem `suppressHydrationWarning`: o servidor agora manda o mesmo atributo
    // que o cliente veria, então não há divergência a suprimir
    <html lang="pt-BR" {...atributos}>
      <body>
        {children}
        <PWARegister />
      </body>
    </html>
  );
}
