export function shouldGuardNavigation({href,current,button=0,modified=false,prevented=false,target="",download=false}:{href:string;current:string;button?:number;modified?:boolean;prevented?:boolean;target?:string;download?:boolean}){
  if(button!==0||modified||prevented||download||target&&target!=="_self")return false;
  try{
    const next=new URL(href,current),source=new URL(current);
    return next.origin===source.origin&&(next.pathname!==source.pathname||next.search!==source.search);
  }catch{return false;}
}

export function hasPendingDraftImages(cards:ReadonlyArray<{file:unknown;imageUrl:string;extraFiles:readonly unknown[]}>){
  return cards.some(card=>Boolean(card.file&&!card.imageUrl.trim())||card.extraFiles.length>0);
}
