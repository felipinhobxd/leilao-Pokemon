import { authorize, failure, HttpError } from "@/lib/backend";
import { buildPollPlan, cardConditions, cardLanguages, DEFAULT_POLL_OPTIONS, MAX_POLL_OPTIONS } from "@/lib/auction-wizard";

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

export async function GET(request: Request) {
  try {
    const { db } = await authorize(request);
    const [{ data: groups, error: groupError }, { data: latest, error: lotError }] = await Promise.all([
      db.from("whatsapp_groups")
        .select("id,name,is_default,last_synced_at")
        .eq("active", true)
        .order("name"),
      db.from("auctions").select("lot_number").order("lot_number", { ascending: false }).limit(1).maybeSingle(),
    ]);
    if (groupError || lotError) throw new Error("auction_wizard_read_failed");
    const list = groups ?? [];
    return Response.json({
      groups: list,
      defaultGroupId: list.find(group => group.is_default)?.id ?? list[0]?.id ?? null,
      suggestedLotNumber: Number(latest?.lot_number ?? 0) + 1,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    const { db, user } = await authorize(request, true);
    if (!request.headers.get("content-type")?.includes("application/json")) throw new HttpError(415, "Envie JSON.");
    const body = await request.json() as Record<string, any>;
    const card = body.card ?? {};
    const auction = body.auction ?? {};

    const eventId = text(body.eventId, true);
    const name = text(card.name, true);
    const collection = text(card.collection);
    const cardNumber = text(card.card_number);
    const variant = text(card.variant);
    const condition = text(card.condition, true);
    const language = text(card.language, true);
    const imageUrl = text(card.image_url);

    if (!(cardConditions as readonly string[]).includes(condition)) throw new HttpError(400, "Condição da carta inválida.");
    if (!cardLanguages.some(item => item.value === language)) throw new HttpError(400, "Idioma da carta inválido.");
    if (imageUrl && !/^https:\/\//i.test(imageUrl)) throw new HttpError(400, "A imagem precisa usar uma URL HTTPS.");

    const startingPrice = Number(auction.starting_price);
    const increment = Number(auction.bid_increment);
    const buyout = auction.buyout_price === null || auction.buyout_price === "" || auction.buyout_price === undefined ? null : Number(auction.buyout_price);
    if (!Number.isFinite(startingPrice) || startingPrice < 0 || !twoDecimals(startingPrice)) throw new HttpError(400, "Lance inicial inválido.");
    if (!Number.isFinite(increment) || increment <= 0 || !twoDecimals(increment)) throw new HttpError(400, "Incremento inválido.");
    if (buyout != null && (!Number.isFinite(buyout) || buyout < startingPrice || !twoDecimals(buyout))) throw new HttpError(400, "ARREMATE inválido.");

    const requestedOptionCount = buyout == null ? Number(auction.option_count ?? DEFAULT_POLL_OPTIONS) : DEFAULT_POLL_OPTIONS;
    if (buyout == null && (!Number.isSafeInteger(requestedOptionCount) || requestedOptionCount < 2 || requestedOptionCount > MAX_POLL_OPTIONS)) {
      throw new HttpError(400, `A enquete sem ARREMATE precisa ter entre 2 e ${MAX_POLL_OPTIONS} opções.`);
    }
    const plan = buildPollPlan(startingPrice, increment, buyout, requestedOptionCount);
    if (plan.overflow && buyout != null && plan.minimumIncrement != null) {
      throw new HttpError(400, `Esses valores gerariam ${plan.optionCount} opções, mas o WhatsApp aceita no máximo ${MAX_POLL_OPTIONS}. Use incremento de pelo menos ${money(plan.minimumIncrement)}.`);
    }
    if (!plan.options.length || plan.options.length > MAX_POLL_OPTIONS) throw new HttpError(400, "Não foi possível montar os valores da enquete.");

    const groupId = String(auction.group_id ?? "");
    if (!uuid.test(groupId)) throw new HttpError(400, "Selecione um grupo do WhatsApp.");
    const scheduledAt = String(auction.scheduled_at ?? "");
    const scheduledTime = Date.parse(scheduledAt);
    if (!Number.isFinite(scheduledTime) || scheduledTime < Date.now() - 120_000) throw new HttpError(400, "Horário de publicação inválido.");
    const endAt = auction.scheduled_end_at ? String(auction.scheduled_end_at) : null;
    if (endAt && (!Number.isFinite(Date.parse(endAt)) || Date.parse(endAt) <= scheduledTime)) throw new HttpError(400, "O encerramento precisa ser depois da publicação.");

    const lotNumber = auction.lot_number === null || auction.lot_number === "" || auction.lot_number === undefined ? null : Number(auction.lot_number);
    if (lotNumber != null && (!Number.isSafeInteger(lotNumber) || lotNumber <= 0)) throw new HttpError(400, "Número do lote inválido.");

    // Validação 4.3: Verificar se a carta referenciada existe no catálogo
    // Se cardNumber e collection forem fornecidos, validar existência no Supabase
    if (cardNumber && collection) {
      const { data: existingCard, error: cardLookupError } = await db
        .from("cards")
        .select("id")
        .eq("card_number", cardNumber)
        .eq("collection", collection)
        .maybeSingle();
      
      if (cardLookupError) {
        console.error("Erro ao validar carta:", cardLookupError);
      }
      
      if (!existingCard) {
        throw new HttpError(400, `Carta não encontrada no catálogo: ${collection} #${cardNumber}. Verifique o número e a coleção.`);
      }
    }

    const payload = {
      eventId,
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
        starting_price: startingPrice,
        bid_increment: increment,
        buyout_price: buyout,
        scheduled_at: new Date(scheduledTime).toISOString(),
        scheduled_end_at: endAt ? new Date(endAt).toISOString() : null,
        group_id: groupId,
        poll_options: plan.options,
      },
    };

    const { data, error } = await db.rpc("create_auction_wizard", { p_payload: payload, p_admin_user_id: user.id });
    if (error) {
      if (/lot_number_in_use/i.test(error.message)) throw new HttpError(409, "Esse número de lote já está em uso.");
      if (/whatsapp_group_unavailable/i.test(error.message)) throw new HttpError(409, "O grupo escolhido não está mais disponível.");
      throw new Error("auction_wizard_create_failed");
    }
    return Response.json({ data }, { status: 201 });
  } catch (error) {
    return failure(error);
  }
}
