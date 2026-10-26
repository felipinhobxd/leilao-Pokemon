// Shared rules for restoring an upload and resending an uncertain creation.
export type PendingCreation = { eventId: string; payload: Record<string, unknown>; editable?: true };
export function mergeImageUrls(previous: string[], uploaded: string[]) {
  return [...new Set([...previous, ...uploaded])].slice(0, 4);
}
export function removeUploadedFile<T>(files: T[], completed: T) {
  return files.filter(file => file !== completed);
}
export function queuePollingDelay(status?: string, hidden = false) {
  return hidden || ["completed", "cancelled"].includes(status ?? "") ? null : 15_000;
}

export function pendingCreationKey(kind:"batch"|"single",userId:string){return `leilao:pending:${kind}:${userId}`;}
export function readPendingCreation(storage:Pick<Storage,"getItem">,key:string):PendingCreation|null{
 try{const value=JSON.parse(storage.getItem(key)??"null");return value?.version===1&&/^[0-9a-f-]{36}$/i.test(value.eventId)&&value.payload&&typeof value.payload==="object"&&!Array.isArray(value.payload)?{eventId:value.eventId,payload:value.payload,...(value.editable===true?{editable:true as const}:{})}:null;}catch{return null;}
}
export function storePendingCreation(storage:Pick<Storage,"setItem"|"removeItem">,key:string,value:PendingCreation|null){
 try{if(value)storage.setItem(key,JSON.stringify({version:1,...value}));else storage.removeItem(key);}catch{/* Browser storage may be disabled; the current tab still retains the operation. */}
}
