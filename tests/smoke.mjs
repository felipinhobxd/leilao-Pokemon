import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','3199'], { stdio:'inherit' });
try {
  let online=false;
  for(let i=0;i<100;i++) {
    try { const response=await fetch('http://127.0.0.1:3199/api/health', { signal: AbortSignal.timeout(500) }); if(response.ok){ online=true;break; } } catch {}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.ok(online,'production server started');
  for(const [path,method] of [
    ['dashboard','GET'],
    ['export','GET'],
    ['commands','POST'],
    ['whatsapp/bot','GET'],
    ['whatsapp/bot','POST'],
    ['whatsapp/schedules','GET'],
  ]) {
    const response=await fetch(`http://127.0.0.1:3199/api/${path}`,{method,signal:AbortSignal.timeout(3000)});
    assert.equal(response.status,401,`${path} ${method} must reject unauthenticated requests`);
  }
  console.log('PASS: dashboard, Excel, commands and WhatsApp routes require authentication.');
} finally { server.kill(); }
