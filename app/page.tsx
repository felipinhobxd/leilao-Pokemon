import Dashboard from "./dashboard";
import DashboardErrorBoundary from "./dashboard-error-boundary";

export default function Home() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    return (
      <main className="shell">
        <section className="panel">
          <p className="eyebrow">CONFIGURAÇÃO</p>
          <h1>Leilão Pokémon</h1>
          <p className="muted">
            O Supabase ainda não foi configurado nesta instância.
          </p>
        </section>
      </main>
    );
  }

  return (
    <DashboardErrorBoundary>
      <Dashboard />
    </DashboardErrorBoundary>
  );
}
