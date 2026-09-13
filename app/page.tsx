import { demoAuction, demoEvents, money } from "@/lib/domain";

function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </div>
  );
}

export default function Home() {
  const auction = demoAuction;

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">CENTRAL DE LEILÕES</p>
          <h1>Leilão Pokémon</h1>
          <p className="muted">WhatsApp + Supabase + painel auditável em tempo real.</p>
        </div>
        <div className="status-pill"><span /> Demonstração</div>
      </header>

      <section className="stats-grid" aria-label="Resumo do leilão">
        <Stat label="Maior lance" value={money(auction.highestBid)} detail={`por ${auction.leader}`} />
        <Stat label="Arremate" value={money(auction.buyoutPrice)} detail="encerra imediatamente" />
        <Stat label="Participantes" value={String(auction.participants)} detail={`${auction.bids} lances registrados`} />
        <Stat label="Encerra" value={auction.endsAt} detail="horário oficial do servidor" />
      </section>

      <section className="main-grid">
        <article className="panel auction-card">
          <div className="panel-title">
            <div>
              <p className="eyebrow">LEILÃO ATUAL</p>
              <h2>{auction.cardName}</h2>
              <p className="muted">{auction.collection} · {auction.cardNumber}</p>
            </div>
            <span className="live-badge">● AO VIVO</span>
          </div>

          <div className="card-content">
            <div className="card-image-wrap">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={auction.imageUrl} alt={`${auction.cardName} ${auction.cardNumber}`} className="card-image" />
            </div>
            <div className="bid-box">
              <span>Líder atual</span>
              <strong>{auction.leader}</strong>
              <b>{money(auction.highestBid)}</b>
              <div className="divider" />
              <span>Preço inicial</span>
              <strong>{money(auction.startingPrice)}</strong>
              <button type="button" disabled>🔥 ARREMATE {money(auction.buyoutPrice)}</button>
              <small>Botão demonstrativo. A ação real será transacional no Supabase.</small>
            </div>
          </div>
        </article>

        <aside className="panel timeline">
          <div className="panel-title compact"><div><p className="eyebrow">AUDITORIA</p><h2>Atividade recente</h2></div></div>
          <div className="events">
            {demoEvents.map((event) => (
              <div className={`event ${event.tone}`} key={event.id}>
                <time>{event.time}</time>
                <div><strong>{event.actor}</strong><p>{event.label}{event.amount ? ` · ${money(event.amount)}` : ""}</p></div>
              </div>
            ))}
          </div>
        </aside>
      </section>

      <section className="panel architecture">
        <div className="panel-title compact"><div><p className="eyebrow">ARQUITETURA</p><h2>Fonte única da verdade</h2></div></div>
        <div className="flow">
          <div>WhatsApp<small>Enquete e participantes</small></div><i>→</i>
          <div>Bot<small>Ponte / eventos</small></div><i>→</i>
          <div className="primary">Supabase<small>Estado oficial</small></div><i>→</i>
          <div>Painel<small>Controle administrativo</small></div><i>→</i>
          <div>Excel<small>Relatório / exportação</small></div>
        </div>
      </section>

      <footer>Protótipo inicial · dados exibidos nesta tela são demonstrativos.</footer>
    </main>
  );
}
