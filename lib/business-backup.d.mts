import type {SupabaseClient} from '@supabase/supabase-js';
export declare function readBusinessBackup(db:SupabaseClient,options?:{signal?:AbortSignal;chunkCharacters?:number}):Promise<{payload:string;export_id:string;exported_at:string;bytes:number}>;
export declare function compressBusinessBackup(payload:string):Promise<Buffer>;
