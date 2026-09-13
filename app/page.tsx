import Link from "next/link";
import Dashboard from "./dashboard";

export default function Home() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    return <main className="shell"><section className="panel"><h1>Leilão Pokémon</h1><p className="muted">O Supabase ainda não foi configurado. Configure o projeto e as variáveis de ambiente para acessar o painel.</p></section></main>;
  }

  const linkStyle = {
    display: "inline-flex", alignItems: "center", gap: 8, padding: "12px 16px", borderRadius: 12,
    border: "1px solid #67531c", fontWeight: 800, textDecoration: "none", boxShadow: "0 12px 30px #0008",
  } as const;

  return <>
    <Dashboard />
    <div style={{ position: "fixed", right: 22, bottom: 22, zIndex: 50, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 9 }}>
      <Link href="/auctions/new" aria-label="Criar novo leilão" style={{ ...linkStyle, background: "var(--accent)", color: "#111318" }}>＋ NOVO LEILÃO</Link>
      <Link href="/whatsapp" aria-label="Abrir área de automação do WhatsApp" style={{ ...linkStyle, background: "#171d2b", color: "var(--text)" }}>💬 Área do WhatsApp</Link>
    </div>
  </>;
}
