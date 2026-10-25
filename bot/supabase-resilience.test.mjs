import test from 'node:test';
import assert from 'node:assert/strict';
import {createSupabaseFetch,createErrorReporter} from './supabase-resilience.mjs';

test('outage circuit pauses calls, probes once, and recovers without replaying writes',async()=>{
  let now=0,calls=0,status=521;
  const fetcher=createSupabaseFetch({now:()=>now,fetchImpl:async()=>{calls++;return new Response('temporary outage',{status});}});
  assert.equal((await fetcher('https://test.supabase.co/rest/v1/rpc/write',{method:'POST'})).status,521);
  await assert.rejects(fetcher('https://test.supabase.co'),/aguardando/);
  assert.equal(calls,1);
  now=10_000;status=200;
  assert.equal((await fetcher('https://test.supabase.co')).status,200);
  assert.equal((await fetcher('https://test.supabase.co')).status,200);
  assert.equal(calls,3);
});
test('HTTP timeout actually aborts the request; logs suppress HTML and repeat storms',async()=>{
  const fetcher=createSupabaseFetch({timeoutMs:10,fetchImpl:(_,init)=>new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(init.signal.reason)))});
  const keepAlive=setTimeout(()=>{},100);
  try{await assert.rejects(fetcher('https://test.supabase.co'),/timeout|aborted/i);}finally{clearTimeout(keepAlive);}
  let now=0;const lines=[];const report=createErrorReporter({now:()=>now,write:x=>lines.push(x)});
  report('Status','<html><title>Supabase 521</title>huge page</html>');report('Status',new Error('again'));
  assert.equal(lines.length,1);assert.match(lines[0],/HTML Supabase 521/);assert.doesNotMatch(lines[0],/<html>/);
  now=60_000;report('Status',new Error('retry'));assert.equal(lines.length,2);
});

test('a real bid still gets one attempt while background polling is paused',async()=>{
  const urls=[];let status=521;
  const fetcher=createSupabaseFetch({now:()=>0,fetchImpl:async url=>{urls.push(url);return new Response('',{status});}});
  await fetcher('https://test.supabase.co/rest/v1/whatsapp_bot_workers');
  status=200;
  assert.equal((await fetcher('https://test.supabase.co/rest/v1/rpc/process_auction_command',{method:'POST'})).status,200);
  assert.equal(urls.length,2);
});
