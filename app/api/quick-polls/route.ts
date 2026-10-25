import {parsePollGame,requireGameBot} from "@/lib/poll-game";
import { authorize, failure, HttpError } from "@/lib/backend";

// P-07 — Brinde rápido: enquete livre (texto/emoji) criada no painel e
// publicada pelo bot no horário agendado ("quem clicar primeiro leva").
// Vota em whatsapp_quick_polls (tabela própria — dispatches exige auction_id).
// GET lista os recentes (agendados + enviados) para /auctions/brinde.
export const runtime = "nodejs";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  try {
    const { db } = await authorize(request, false);
    const { data, error } = await db.from("whatsapp_quick_polls")
      .select("id,group_id,title,options,scheduled_at,sent_at,poll_message_id,created_at,game_kind,prize_name,winner_name,won_at")
      .order("created_at", { ascending: false })
      .limit(20);
    if (error) throw new Error("quick_polls_read_failed");
    return Response.json({ data: data ?? [] }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    const {db,user}=await authorize(request,true);
    if (!request.headers.get('content-type')?.includes('application/json')) throw new HttpError(415,'Envie JSON.');
    const body=await request.json();
    let game;
    try { game=parsePollGame({kind:body.kind,options:body.options,correctIndex:body.correctIndex,prizeName:body.prizeName,question:body.title}); }
    catch(error) { throw new HttpError(400,error instanceof Error?error.message:'Enquete inválida.'); }
    const title=String(body.title??'').trim(),eventId=String(body.eventId??'').trim(),groupId=String(body.groupId??'');
    const scheduledAt=body.scheduledAt?String(body.scheduledAt):new Date().toISOString();
    const imageUrl=String(body.imageUrl??'').trim();
    if(!title || title.length>200 || !eventId || eventId.length>189 || !uuid.test(groupId) || !Number.isFinite(Date.parse(scheduledAt)) || (imageUrl && (!/^https:\/\//.test(imageUrl)||imageUrl.length>500))) throw new HttpError(400,'Confira título, grupo, imagem e horário da publicação.');
    if(game.kind!=='legacy')try{await requireGameBot(db);}catch(error){throw new HttpError(409,(error as Error).message);}
    const {data,error}=await db.rpc('create_quick_poll_game',{p_admin_user_id:user.id,p_payload:{eventId,groupId,title,options:game.options,kind:game.kind,correctIndex:game.correctIndex,prizeName:game.prizeName,scheduledAt,imageUrl}});
    if(error){
      if(/event_id_conflict/.test(error.message))throw new HttpError(409,'Esta operação já foi enviada com outros dados.');
      if(/invalid_poll_game/.test(error.message))throw new HttpError(400,'Confira as opções, a resposta correta, a carta e o horário.');
      if(/whatsapp_group_unavailable/.test(error.message))throw new HttpError(409,'O grupo não está disponível.');
      throw new Error('quick_poll_create_failed');
    }
    return Response.json({data},{status:201,headers:{'Cache-Control':'private, no-store'}});
  } catch(error){return failure(error);}
}
