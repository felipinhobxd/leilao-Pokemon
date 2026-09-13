import Dashboard from "./dashboard";

export default function Home() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    return <main className="shell"><section className="panel"><h1>Leilão Pokémon</h1><p className="muted">O Supabase ainda não foi configurado. Configure o projeto e as variáveis de ambiente para acessar o painel.</p></section></main>;
  }
  return <Dashboard />;
}
