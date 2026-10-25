import type { Metadata } from "next";
import "./globals.css";
import SiteNavigation from './site-navigation';
import {NavigationGuardProvider} from './navigation-guard';

export const metadata: Metadata = {
  title: "Leilão Pokémon",
  description: "Painel de leilões de cartas Pokémon integrado ao WhatsApp",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body><NavigationGuardProvider><SiteNavigation />{children}</NavigationGuardProvider></body>
    </html>
  );
}
