import type { Metadata, Viewport } from "next";
import "./globals.css";
import { PWARegister } from "@/components/pwa-register";

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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // `suppressHydrationWarning`: o script abaixo escreve `data-theme` no <html>
    // ANTES da hidratação (é o que evita o flash de tema errado). O servidor não
    // renderiza esse atributo, então sem isto o React acusa divergência em toda
    // visita de quem salvou o tema escuro. A supressão vale só para este
    // elemento e para os atributos dele, não para o conteúdo da página.
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        {/* Aplica tema e estado da barra lateral ANTES do primeiro paint. Os
            dois pela mesma razão: sem isto a página abre no padrão e salta para
            a escolha da pessoa na frente dela. O padrão é Mineral claro e barra
            aberta, então só quem escolhe o contrário grava preferência. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var d=document.documentElement;if(localStorage.getItem('orbita.theme')==='dark')d.dataset.theme='dark';if(localStorage.getItem('orbita.lateral')==='recolhida')d.dataset.lateral='recolhida'}catch(e){}`,
          }}
        />
      </head>
      <body>
        {children}
        <PWARegister />
      </body>
    </html>
  );
}
