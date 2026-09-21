import { authorize, failure } from "@/lib/backend";
import { issueRecognitionServiceToken } from "@/lib/card-recognition-token.mjs";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { user } = await authorize(request, true);
    const issued = issueRecognitionServiceToken(user.id);
    return Response.json(issued, {
      headers: {
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return failure(error);
  }
}
