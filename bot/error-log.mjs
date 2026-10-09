// Log de erros em UMA linha legível (2026-10-08). Quando o Supabase sai do ar,
// o Cloudflare devolve PÁGINAS HTML INTEIRAS (520/521/525) como error.message
// — imprimir isso cru afoga o terminal, infla os arquivos em bot/logs e
// esconde o que importa. describeError extrai o <title> da página, remove
// tags, colapsa espaços e trunca. Mesma família do voto-log: módulo puro,
// testável (bot/error-log.test.mjs).
export function describeError(error, limit = 300) {
  let text;
  if (error instanceof Error) {
    // Class + mensagem (a mensagem pode ser multilinha — ex.: página HTML
    // inteira; o colapso de espaços abaixo cuida disso). O stack NÃO entra:
    // a primeira linha dele corta na quebra de linha da própria mensagem.
    text = `${error.constructor?.name ?? "Error"}: ${error.message ?? ""}`.trim();
    if (!text) text = error.stack?.split("\n")[0] ?? "Error";
  } else {
    text = error?.message ?? error?.error?.message ?? error?.msg ?? error;
  }
  text = String(text ?? error);
  const title = text.match(/<title[^>]*>\s*([^<]{1,180})\s*<\/title>/i);
  if (title) {
    text = `HTML ${title[1].trim()}`;
  } else if (/<\/?[a-z!][^>]*>/i.test(text)) {
    text = text.replace(/<[^>]*>/g, " ").replace(/&[a-z#0-9]+;/gi, " ");
  }
  text = text.replace(/\s+/g, " ").trim();
  if (text === "[object Object]") {
    try { text = JSON.stringify(error); } catch { text = "erro não serializável"; }
  }
  if (!text) text = error instanceof Error ? error.constructor.name : typeof error;
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}
