import { authorize, failure, HttpError } from "@/lib/backend";
import { buildCustomValuesPlan, buildPollPlan, cardConditions, cardLanguages, DEFAULT_POLL_OPTIONS, MAX_POLL_OPTIONS, parseCustomValues } from "@/lib/auction-wizard";

export const runtime = "nodejs";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const twoDecimals = (value: number) => Math.abs(value * 100 - Math.round(value * 100)) < 0.00001;
const money = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
const text = (value: unknown, required = false) => {
  const result = String(value ?? "").trim();
  if (required && !result) throw new HttpError(400, "Preencha todos os campos obrigatórios.");
  if (result.length > 200) throw new HttpError(400, "Um dos textos informados é muito longo.");
  return result;
};

export async function POST(request: Request) {
  try {
    const { db, user } = await authorize(request, true);
    if (!request.headers.get("content-type")?.includes("application/json")) throw new HttpError(415, "Envie JSON.");
    const body = await request.json() as Record<string, any>;
    const eventId = text(body.eventId, true);
    const queue = body.queue ?? {};
    const sourceItems = Array.isArray(body.items) ? body.items : [];
    if (!sourceItems.length || sourceItems.length > 100) throw new HttpError(400, "A fila precisa ter entre 1 e 100 cartas.");

    const groupId = String(queue.group_id ?? "");
    if (!uuid.test(groupId)) throw new HttpError(400, "Selecione um grupo do WhatsApp.");
    const startsAt = String(queue.starts_at ?? "");
    const startsTime = Date.parse(startsAt);
    if (!Number.isFinite(startsTime) || startsTime < Date.now() - 120_000) throw new HttpError(400, "Horário de início inválido.");
    const intervalSeconds = Number(queue.interval_seconds);
    if (!Number.isSafeInteger(intervalSeconds) || intervalSeconds < 1 || intervalSeconds > 86400) throw new HttpError(400, "Intervalo entre publicações inválido.");

    const seenLots = new Set<number>();
    const items = sourceItems.map((source: any, index: number) => {
      const card = source?.card ?? {};
      const auction = source?.auction ?? {};
      const label = `Carta ${index + 1}`;
      const name = text(card.name, true);
      const collection = text(card.collection);
      const cardNumber = text(card.card_number);
      const variant = text(card.variant);
      const condition = text(card.condition, true);
      const language = text(card.language, true);
      const imageUrl = text(card.image_url);
      if (!(cardConditions as readonly string[]).includes(condition)) throw new HttpError(400, `${label}: condição inválida.`);
      if (!cardLanguages.some(item => item.value === language)) throw new HttpError(400, `${label}: idioma inválido.`);
      if (imageUrl && !/^https:\/\//i.test(imageUrl)) throw new HttpError(400, `${label}: imagem inválida.`);

      const startingPrice = Number(auction.starting_price);
      const increment = Number(auction.bid_increment);
      const buyout = auction.buyout_price === null || auction.buyout_price === "" || auction.buyout_price === undefined ? null : Number(auction.buyout_price);
      const durationSeconds = Number(auction.duration_seconds);
      if (!Number.isSafeInteger(durationSeconds) || durationSeconds < 1 || durationSeconds > 604800) throw new HttpError(400, `${label}: duração inválida.`);

      // Modo de valores por item (o mesmo do wizard de carta única): "increment"
      // (padrão) ou "custom" — o operador digita os valores exatos da enquete.
      const pricingMode = String(auction.pricing_mode ?? "increment");
      let planOptions: { label: string; amount: number; isBuyout: boolean }[] = [];
      let effectiveStarting = startingPrice;
      let effectiveIncrement = increment;
      let effectiveBuyout = buyout;

      if (pricingMode === "custom") {
        const rawValues = auction.custom_values;
        const values = Array.isArray(rawValues)
          ? rawValues.map(value => Number(value))
          : parseCustomValues(String(rawValues ?? ""));
        if (!values) throw new HttpError(400, `${label}: valores personalizados inválidos.`);
        const plan = buildCustomValuesPlan(values, Boolean(auction.custom_buyout_last));
        if (plan.error) throw new HttpError(400, `${label}: ${plan.error}`);
        if (!plan.options.length || plan.options.length > MAX_POLL_OPTIONS) throw new HttpError(400, `${label}: não foi possível montar a enquete.`);
        planOptions = plan.options;
        effectiveStarting = plan.startingPrice;
        effectiveIncrement = plan.bidIncrement ?? 0.01;
        effectiveBuyout = plan.buyoutPrice;
      } else {
        if (!Number.isFinite(startingPrice) || startingPrice < 0 || !twoDecimals(startingPrice)) throw new HttpError(400, `${label}: lance inicial inválido.`);
        if (!Number.isFinite(increment) || increment <= 0 || !twoDecimals(increment)) throw new HttpError(400, `${label}: incremento deve ser maior que R$ 0.`);
        if (buyout != null && (!Number.isFinite(buyout) || buyout <= startingPrice || !twoDecimals(buyout))) throw new HttpError(400, `${label}: ARREMATE deve ser maior que o lance inicial.`);

        const requestedOptionCount = buyout == null ? Number(auction.option_count ?? DEFAULT_POLL_OPTIONS) : DEFAULT_POLL_OPTIONS;
        if (buyout == null && (!Number.isSafeInteger(requestedOptionCount) || requestedOptionCount < 2 || requestedOptionCount > MAX_POLL_OPTIONS)) {
          throw new HttpError(400, `${label}: escolha entre 2 e ${MAX_POLL_OPTIONS} opções.`);
        }
        const plan = buildPollPlan(startingPrice, increment, buyout, requestedOptionCount);
        if (plan.overflow && buyout != null && plan.minimumIncrement != null) {
          throw new HttpError(400, `${label}: os valores gerariam ${plan.optionCount} opções. Use incremento de pelo menos ${money(plan.minimumIncrement)}.`);
        }
        if (!plan.options.length || plan.options.length > MAX_POLL_OPTIONS) throw new HttpError(400, `${label}: não foi possível montar a enquete.`);
        planOptions = plan.options;
      }

      const lotNumber = Number(auction.lot_number);
      if (!Number.isSafeInteger(lotNumber) || lotNumber <= 0) throw new HttpError(400, `${label}: número do lote inválido.`);
      if (seenLots.has(lotNumber)) throw new HttpError(400, `O lote ${lotNumber} aparece mais de uma vez na fila.`);
      seenLots.add(lotNumber);

      return {
        card: {
          name,
          collection,
          card_number: cardNumber,
          variant,
          condition,
          language,
          image_url: imageUrl || null,
        },
        auction: {
          lot_number: lotNumber,
          starting_price: effectiveStarting,
          bid_increment: effectiveIncrement,
          buyout_price: effectiveBuyout,
          duration_seconds: durationSeconds,
          poll_options: planOptions,
        },
      };
    });

    const payload = {
      eventId,
      queue: {
        group_id: groupId,
        starts_at: new Date(startsTime).toISOString(),
        interval_seconds: intervalSeconds,
      },
      items,
    };

    const { data, error } = await db.rpc("create_auction_publish_queue", { p_payload: payload, p_admin_user_id: user.id });
    if (error) {
      if (/lot_number_in_use/i.test(error.message)) throw new HttpError(409, "Um dos números de lote já está em uso.");
      if (/whatsapp_group_unavailable/i.test(error.message)) throw new HttpError(409, "O grupo escolhido não está mais disponível.");
      if (/event_id_conflict/i.test(error.message)) throw new HttpError(409, "Essa criação já foi enviada com dados diferentes.");
      throw new Error("auction_queue_create_failed");
    }
    return Response.json({ data }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}
