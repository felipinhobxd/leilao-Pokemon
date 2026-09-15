"use client";

import { useEffect, useState } from "react";
import {
  imageRecognitionEnabled,
  imageRecognitionPreferenceEvent,
  setImageRecognitionEnabled,
} from "@/lib/card-recognition-local";

export default function RecognitionToggle() {
  const [enabled, setEnabled] = useState(true);

  useEffect(() => {
    const sync = () => {
      const current = imageRecognitionEnabled();
      setEnabled(current);
      document.body.dataset.imageRecognition = current ? "on" : "off";
    };
    sync();
    window.addEventListener(imageRecognitionPreferenceEvent, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(imageRecognitionPreferenceEvent, sync);
      window.removeEventListener("storage", sync);
      delete document.body.dataset.imageRecognition;
    };
  }, []);

  function toggle() {
    const next = !enabled;
    setImageRecognitionEnabled(next);
    setEnabled(next);
    document.body.dataset.imageRecognition = next ? "on" : "off";
  }

  return <>
    <div style={{ maxWidth: 1180, margin: "18px auto 0", padding: "0 18px" }}>
      <button
        type="button"
        className={enabled ? "" : "secondary"}
        aria-pressed={enabled}
        onClick={toggle}
      >
        {enabled ? "🟢" : "⚪"} Reconhecimento de imagens: {enabled ? "Ligado" : "Desligado"}
      </button>
      <span className="muted" style={{ marginLeft: 10 }}>
        {enabled ? "As imagens serão analisadas automaticamente." : "As imagens serão adicionadas sem usar a IA."}
      </span>
    </div>
    <style jsx global>{`
      body[data-image-recognition="off"] .recognition-inline,
      body[data-image-recognition="off"] .recognition-box,
      body[data-image-recognition="off"] .recognition-inspector {
        display: none !important;
      }
    `}</style>
  </>;
}
