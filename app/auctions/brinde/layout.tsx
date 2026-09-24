import type { ReactNode } from "react";

// A página é client-side e lança no createPublicSupabaseClient quando as env
// públicas estão ausentes (CI/Vercel sem .env.local): sem force-dynamic o
// prerender estático do Export falha o build inteiro (mesmo padrão do
// layout da Central WhatsApp).
export const dynamic = "force-dynamic";

export default function BrindeLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <>{children}</>;
}
