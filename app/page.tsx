import Link from "next/link";
import Dashboard from "./dashboard";

export default function Home() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    return <main className="shell"><section className="panel"><h1>Leilão Pokémon</h1><p className="muted">O Supabase ainda não foi configurado. Configure o projeto e as variáveis de ambiente para acessar o painel.</p></section></main>;
  }

  return <>
    <Dashboard />
    <Link
      href="/whatsapp"
      aria-label="Abrir área de automação do WhatsApp"
      style={{
        position: "fixed",
        right: 22,
        bottom: 22,
        zIndex: 50,
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "12px 16px",
        borderRadius: 12,
        border: "1px solid #67531c",
        background: "var(--accent)",
        color: "#111318",
        fontWeight: 800,
        textDecoration: "none",
        boxShadow: "0 12px 30px #0008",
      }}
    >
      💬 Área do WhatsApp
    </Link>
  </>;
}
