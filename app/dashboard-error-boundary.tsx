"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

export default class DashboardErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[dashboard] render error", error, info);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="shell">
        <section className="panel">
          <p className="eyebrow">ERRO NO PAINEL</p>
          <h1>Leilão Pokémon</h1>
          <p className="muted" style={{ marginTop: 12 }}>
            A interface encontrou um erro ao iniciar. O servidor e o banco continuam preservados.
          </p>
          <pre
            style={{
              marginTop: 18,
              padding: 14,
              borderRadius: 12,
              background: "var(--surface)",
              border: "1px solid var(--line)",
              color: "var(--danger-text)",
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
            }}
          >
            {this.state.error.message || String(this.state.error)}
          </pre>
          <div className="actions" style={{ marginTop: 16 }}>
            <button type="button" onClick={() => window.location.reload()}>
              Recarregar painel
            </button>
          </div>
        </section>
      </main>
    );
  }
}
