import { authorize, failure } from "@/lib/backend";
import { prepareBackupDownload } from "@/lib/backup-download";

// Generate a consistent snapshot and return a private, expiring Storage link.
// The large compressed file goes directly from Storage to the browser.
export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(request: Request) {
  try {
    const { db, user } = await authorize(request, true);
    try {
      const download = await prepareBackupDownload(db,user.id);
      return Response.json(download,{headers:{"Cache-Control":"private, no-store"}});
    } catch (issue) {
      if (issue instanceof Error && String((issue.cause as {message?:unknown})?.message??"").includes("backup_busy")) return Response.json({error:"Já há um backup sendo preparado. Aguarde alguns minutos e tente novamente."},{status:429,headers:{"Cache-Control":"no-store","Retry-After":"30"}});
      return Response.json({error:"Não foi possível preparar o backup. O Supabase pode estar indisponível ou sem espaço no Storage. Tente novamente em alguns instantes."},{status:503,headers:{"Cache-Control":"no-store","Retry-After":"30"}});
    }
  } catch (error) {
    return failure(error);
  }
}
