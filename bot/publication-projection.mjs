// Dispatch IDs are durable before this projection runs. A projection failure
// must not turn an already delivered WhatsApp message into a failed dispatch.
export async function syncPublicationProjection({ db, auctionId, values, reportError }) {
  let failure;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { data, error } = await db.from("auctions").update(values)
        .eq("id", auctionId).select("id").maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new Error("auction_publication_projection_missing");
      return true;
    } catch (error) {
      failure = error;
    }
  }
  reportError("Falha ao sincronizar IDs da publicação; dispatch preservado", failure);
  return false;
}
