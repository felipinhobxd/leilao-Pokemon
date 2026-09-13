import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Leilão Pokémon",
  description: "Painel de leilões de cartas Pokémon integrado ao WhatsApp",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
