// Trava de sessão única do Baileys. A RECONEXÃO do socket é responsabilidade
// exclusiva de connect() (index.mjs, evento connection.update) e do
// supervisor (service.mjs, restart a cada 5s) — a fila persistente de
// disparos (queue-worker.mjs) apenas ESPERA socketReady(); ela nunca
// reconecta, nunca cria socket e nunca disputa a sessão.
import net from 'node:net';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Both the existing service and foreground entry use this guard. A supervisor's
// immediate child inherits ownership; a second launcher/service fails closed.
if (Number(process.env.LEILAO_SESSION_OWNER_PID) !== process.ppid) {
  const here = fileURLToPath(new URL('./', import.meta.url));
  let session = path.resolve(here, process.env.WHATSAPP_SESSION_DIR || './sessao');
  if (process.platform === 'win32') session = session.toLowerCase();
  const port = 40000 + createHash('sha256').update(session).digest().readUInt16BE(0) % 20000;
  const guard = net.createServer(socket => socket.destroy());
  await new Promise((resolve, reject) => {
    guard.once('error', () => reject(new Error('Já existe um bot usando esta sessão, ou a porta de proteção está ocupada. Encerre o outro serviço antes de iniciar.')));
    guard.listen({ host: '127.0.0.1', port, exclusive: true }, resolve);
  });
  guard.unref();
  process.env.LEILAO_SESSION_OWNER_PID = String(process.pid);
}
