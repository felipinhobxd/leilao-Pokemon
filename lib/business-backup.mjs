import {randomUUID} from 'node:crypto';
import {gzip} from 'node:zlib';
import {promisify} from 'node:util';
export const compressBusinessBackup=promisify(gzip);

// A single database snapshot, transferred in bounded text chunks. PostgreSQL
// offsets count Unicode characters, not JS UTF-16 units or UTF-8 bytes.
export async function readBusinessBackup(db,{signal=AbortSignal.timeout(100_000),chunkCharacters=262144}={}) {
  if(!Number.isSafeInteger(chunkCharacters)||chunkCharacters<1||chunkCharacters>262144)throw new Error('invalid_backup_chunk_size');
  let id;
  try {
    const prepared=await db.rpc('prepare_business_backup',{p_export_id:randomUUID()}).abortSignal(signal);
    if(prepared.error)throw new Error('backup_export_unavailable',{cause:prepared.error});
    const meta=prepared.data;id=meta?.id;
    if(!id || !Number.isSafeInteger(meta.characters) || meta.characters<1 || meta.characters>100_000_000)throw new Error('backup_metadata_invalid');
    const chunks=[];
    for(let offset=1;offset<=meta.characters;offset+=chunkCharacters){
      const part=await db.rpc('read_business_backup_chunk',{p_export_id:id,p_offset:offset,p_length:chunkCharacters}).abortSignal(signal);
      if(part.error)throw new Error('backup_chunk_unavailable',{cause:part.error});
      if(typeof part.data!=='string'||!part.data.length)throw new Error('backup_chunk_invalid');
      chunks.push(part.data);
    }
    const payload=chunks.join('');
    if(Buffer.byteLength(payload)!==meta.bytes)throw new Error('backup_size_mismatch');
    return {payload,export_id:id,exported_at:meta.exported_at,bytes:meta.bytes};
  }finally{
    if(id){try{await db.rpc('discard_business_backup',{p_export_id:id}).abortSignal(AbortSignal.timeout(10_000));}catch{}}
  }
}
