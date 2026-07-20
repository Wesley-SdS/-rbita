import type { Metadata, Viewport } from "next";
import { Orbitron } from "next/font/google";
import "./globals.css";
import { PWARegister } from "@/components/pwa-register";

const orbitron = Orbitron({
  subsets: ["latin"],
  weight: ["500", "700", "900"],
  variable: "--font-orbitron",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ÓRBITA — Assistente Pessoal",
  description: "Seu assistente pessoal de IA, local-first.",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "ÓRBITA" },
  icons: { icon: "/icon-192.png", apple: "/icon-192.png" },
};

export const viewport: Viewport = {
  themeColor: "#120d08",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={orbitron.variable}>
      <head>
        {/* Aplica o tema salvo ANTES do primeiro paint (evita flash de tema errado). */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('orbita.theme');if(t==='light')document.documentElement.dataset.theme='light'}catch(e){}`,
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
