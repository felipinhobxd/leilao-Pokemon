import { authorize, failure, snapshot } from "@/lib/backend";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    const { db, profile } = await authorize(request);
    return Response.json({ data: await snapshot(db), role: profile.role }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}
