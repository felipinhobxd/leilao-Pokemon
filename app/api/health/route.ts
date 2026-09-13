export async function GET() {
  return Response.json({
    ok: true,
    service: "leilao-pokemon",
    timestamp: new Date().toISOString(),
  });
}
