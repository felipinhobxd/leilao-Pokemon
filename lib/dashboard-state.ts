import type {Row,Snapshot} from "./backend";
export type LiveAuctionState={auction:Row|null;card:Row|null;winner:Row|null;bids:Array<Row & {participant:Row}>;participantCount:number;purchases?:Row[]};
function replaceRow(rows:Row[],row:Row){
 const index=rows.findIndex(item=>item.id===row.id);
 if(index<0)return [...rows,row];
 return rows.map((item,i)=>i===index?row:item);
}
/** A finalization may commit between the broad snapshot and the live read. */
export function mergeLiveAuction(snapshot:Snapshot,live:LiveAuctionState|null):Snapshot{
 return {...snapshot,auctions:live?.auction?replaceRow(snapshot.auctions,live.auction):snapshot.auctions,cards:live?.card?replaceRow(snapshot.cards,live.card):snapshot.cards,purchases:live?.purchases??snapshot.purchases};
}
