// Validação de lote contra o catálogo de reconhecimento (Fase 4.3).
//
// O catálogo de cartas vive no SQLite LOCAL do PC do bot — não no Supabase.
// Portanto a validação de "essa carta existe?" consulta o serviço local de
// reconhecimento (127.0.0.1:8765), que é a única coisa com acesso ao
// catálogo. Honestidade do deploy: quando a API roda fora do PC do bot
// (Vercel) o localhost é inalcançável — nesse caso o lote é criado SEM
// validação e um log registra o fato; RECOGNITION_STRICT_CATALOG=1 ativa o
// modo estrito (bloqueia o lote que não pôde ser validado) para quem roda
// site+serviço na mesma máquina e quer a garantia total.

const SERVICE_BASE = process.env.RECOGNITION_BASE_URL || "http://127.0.0.1:8765";
const CHECK_TIMEOUT_MS = 1500;

export type CatalogCheck = {
  /** true = o catálogo respondeu com um veredito; false = não validado. */
  checked: boolean;
  /** O veredito em si (só tem valor com checked=true). */
  exists: boolean;
  cardId: string | null;
  setId: string | null;
  /** Motivo da não-validação (serviço offline/timeout), p/ log e modo estrito. */
  unreachable?: string;
};

export function isStrictCatalogMode(): boolean {
  return process.env.RECOGNITION_STRICT_CATALOG === "1";
}

export async function validateCardAgainstCatalog(input: {
  language: string;
  set: string;
  number: string;
}): Promise<CatalogCheck> {
  const setRef = String(input.set ?? "").trim();
  const number = String(input.number ?? "").trim();
  // Sem coleção/número não há referência a validar — lotes assim seguem
  // (sempre existiram) e nada é rejeitado por falta do que consultar.
  if (!setRef || !number) return { checked: false, exists: false, cardId: null, setId: null };

  const params = new URLSearchParams({ language: input.language, set: setRef, number });
  const url = `${SERVICE_BASE}/catalog/exists?${params}`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) });
    if (!response.ok) {
      return { checked: false, exists: false, cardId: null, setId: null,
               unreachable: `HTTP ${response.status} do serviço de catálogo` };
    }
    const payload = (await response.json()) as { exists?: boolean; cardId?: string | null; setId?: string | null };
    return {
      checked: true,
      exists: Boolean(payload.exists),
      cardId: payload.cardId ?? null,
      setId: payload.setId ?? null,
    };
  } catch (error) {
    return { checked: false, exists: false, cardId: null, setId: null,
             unreachable: error instanceof Error ? error.message : String(error) };
  }
}
