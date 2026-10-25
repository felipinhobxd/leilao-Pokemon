"use client";
import { useEffect, useRef, useState } from "react";
import { COMPLETED_AUCTIONS_STEP1, COMPLETED_AUCTIONS_STEP2, isCompletedAuctionsConfirmed, isCompletedAuctionsStep1 } from "../lib/purge";

type Props = {
  busy: boolean;
  error: string;
  onClose: () => void;
  onConfirm: (confirm1: string, confirm2: string, eventId: string) => Promise<void>;
};

export default function CompletedAuctionsDeleteDialog({ busy, error, onClose, onConfirm }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const eventId = useRef("");
  const [step1, setStep1] = useState("");
  const [step2, setStep2] = useState("");
  useEffect(() => {
    eventId.current = crypto.randomUUID();
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
  }, []);
  return <dialog ref={dialog} className="panel modal" aria-labelledby="delete-completed-title" aria-describedby="delete-completed-description" onCancel={event => { if (busy) event.preventDefault(); else onClose(); }}>
    <h2 id="delete-completed-title">Excluir todos os leilões encerrados</h2>
    <p id="delete-completed-description">Exclui definitivamente TODOS os leilões vendidos, encerrados sem vencedor e cancelados, inclusive os que não aparecem na lista do painel. Leilões abertos, rascunhos, agendados e em revisão são mantidos.</p>
    <p className="muted">Lances, votos, publicações, eventos, compras, pagamentos e entregas vinculados também serão apagados, mesmo com pendências. Cartas sem outro leilão serão excluídas. Não há como desfazer.</p>
    {error && <p role="alert" className="alert">{error}</p>}
    <form className="form-grid" onSubmit={event => {
      event.preventDefault();
      if (!busy && eventId.current && isCompletedAuctionsConfirmed(step1, step2)) void onConfirm(step1, step2, eventId.current);
    }}>
      <label>1ª confirmação — digite <strong>{COMPLETED_AUCTIONS_STEP1}</strong><input autoFocus value={step1} disabled={busy} onChange={event => { setStep1(event.target.value); setStep2(""); }} placeholder={COMPLETED_AUCTIONS_STEP1} autoComplete="off" spellCheck={false} /></label>
      {isCompletedAuctionsStep1(step1) && <label>2ª confirmação — digite <strong>{COMPLETED_AUCTIONS_STEP2}</strong><input value={step2} disabled={busy} onChange={event => setStep2(event.target.value)} placeholder={COMPLETED_AUCTIONS_STEP2} autoComplete="off" spellCheck={false} /></label>}
      <div className="actions"><button className="danger-btn" type="submit" disabled={busy || !isCompletedAuctionsConfirmed(step1, step2)}>{busy ? "Excluindo…" : "Excluir encerrados definitivamente"}</button><button type="button" disabled={busy} onClick={onClose}>Cancelar</button></div>
    </form>
  </dialog>;
}
