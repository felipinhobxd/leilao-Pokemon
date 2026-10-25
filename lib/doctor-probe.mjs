export function probeHeaders(key){return key.startsWith('sb_secret_')?{apikey:key}:{apikey:key,Authorization:`Bearer ${key}`};}
export function probeColumn(table){return table==='payment_reminders'?'purchase_id':'id';}
export function readableTable(response){return response.ok;}
