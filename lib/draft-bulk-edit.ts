import {buildCustomValuesPlan,buildPollPlan,cardConditions,cardLanguages,parseCustomValues} from "./auction-wizard.ts";

export type BulkEditableCard={id:string;name:string;giveaway:boolean;language:string;condition:string;variant:string;pricingMode:"increment"|"custom";startingPrice:string;increment:string;buyout:string;optionCount:string;durationMinutes:string;customValues:string;customBuyoutLast:boolean};
type Settings=Pick<BulkEditableCard,"language"|"condition"|"variant"|"pricingMode"|"startingPrice"|"increment"|"buyout"|"optionCount"|"durationMinutes"|"customValues"|"customBuyoutLast">;
type Patch=Partial<Settings>;
export type BulkEditField="language"|"condition"|"variant"|"startingPrice"|"increment"|"buyout"|"clearBuyout"|"optionCount"|"durationMinutes"|"customValues"|"copy";
export type BulkEditAction={field:Exclude<BulkEditField,"copy"|"customValues">;value:string}|{field:"customValues";value:string;buyoutLast:boolean}|{field:"copy";sourceId:string};
export type BulkEditChange={id:string;before:Patch;after:Patch};
const moneyLimit=9_999_999_999.99;
const commonFields=new Set<BulkEditField>(["language","condition","variant","copy"]);
const automaticFields=new Set<BulkEditField>(["startingPrice","increment","buyout","clearBuyout","optionCount"]);
const allowedFields=new Set<BulkEditField>([...commonFields,...automaticFields,"durationMinutes","customValues"]);
const priceKeys=new Set<keyof Settings>(["pricingMode","startingPrice","increment","buyout","optionCount","customValues","customBuyoutLast"]);

export function bulkFieldEligible(card:BulkEditableCard,field:BulkEditField){
  return commonFields.has(field)||!card.giveaway&&(!automaticFields.has(field)||card.pricingMode==="increment")&&(field!=="optionCount"||!card.buyout.trim());
}
function decimal(raw:string,min:number,max:number){
  const text=raw.trim().replace(",",".");
  if(!/^\d+(\.\d{1,2})?$/.test(text))throw new Error("Informe um número válido, com até duas casas decimais.");
  const value=Number(text);
  if(!Number.isFinite(value)||value<min||value>max)throw new Error(`Informe um valor entre ${min} e ${max}.`);
  return String(value);
}
function validatePricing(card:BulkEditableCard){
  if(card.pricingMode==="increment"){
    try{decimal(card.startingPrice,0,moneyLimit);decimal(card.increment,0.01,moneyLimit);if(card.buyout.trim())decimal(card.buyout,0.01,moneyLimit);}
    catch{throw new Error(`${card.name||"Uma das cartas"}: informe preços válidos, com até duas casas decimais.`);}
  }
  const values=card.pricingMode==="custom"?parseCustomValues(card.customValues):null;
  const plan=card.pricingMode==="custom"?buildCustomValuesPlan(values??[],card.customBuyoutLast):buildPollPlan(Number(card.startingPrice),Number(card.increment),card.buyout.trim()?Number(card.buyout):null,Number(card.optionCount));
  if("error" in plan&&plan.error||plan.options.length<2||plan.options.length>12||plan.options.some(option=>!Number.isFinite(option.amount)||option.amount<0||option.amount>moneyLimit))throw new Error(`${card.name||"Uma das cartas"}: os valores resultariam em uma enquete inválida. Confira o inicial, incremento, arremate e limite de 12 opções.`);
}
function actionPatch(action:BulkEditAction,allowDuration:boolean):Patch{
  if(action.field==="copy")return {};
  if(action.field==="language"){
    if(!cardLanguages.some(item=>item.value===action.value))throw new Error("Selecione um idioma válido.");
    return {language:action.value};
  }
  if(action.field==="condition"){
    if(!(cardConditions as readonly string[]).includes(action.value))throw new Error("Selecione uma condição válida.");
    return {condition:action.value};
  }
  if(action.field==="variant"){
    const variant=action.value.trim();if(!variant||variant.length>120)throw new Error("Informe uma variante com até 120 caracteres.");return {variant};
  }
  if(action.field==="clearBuyout")return {buyout:""};
  if(action.field==="durationMinutes"){
    if(!allowDuration)throw new Error("A fila usa encerramento comum. A duração individual não será alterada.");
    return {durationMinutes:decimal(action.value,0.1,10080)};
  }
  if(action.field==="optionCount"){
    const count=Number(action.value);if(!Number.isSafeInteger(count)||count<2||count>12)throw new Error("A enquete aceita de 2 a 12 opções.");return {optionCount:String(count)};
  }
  if(action.field==="customValues"){
    const values=parseCustomValues(action.value);const plan=buildCustomValuesPlan(values??[],action.buyoutLast);
    if(plan.error||!values||values.some(value=>value>moneyLimit))throw new Error(plan.error||"Informe valores personalizados válidos.");
    return {pricingMode:"custom",customValues:values.join(", "),customBuyoutLast:action.buyoutLast};
  }
  return {[action.field]:decimal(action.value,action.field==="startingPrice"?0:0.01,moneyLimit)};
}

/** Atomic, identity-based edits. Whitelist deliberately excludes media, lot,
 * name/number, card type and every quiz question/answer/prize field. */
export function applyDraftBulkEdit<T extends BulkEditableCard>(cards:readonly T[],selected:ReadonlySet<string>,action:BulkEditAction,{allowDuration=false}={}){
  if(!allowedFields.has(action.field))throw new Error("Esse campo não pode ser alterado em massa.");
  const targets=cards.filter(card=>selected.has(card.id));
  if(!targets.length)throw new Error("Selecione pelo menos uma carta.");
  const source=action.field==="copy"?cards.find(card=>card.id===action.sourceId):null;
  if(action.field==="copy"&&!source)throw new Error("Escolha a carta de origem.");
  const patch=actionPatch(action,allowDuration),changes:BulkEditChange[]=[];
  let eligible=0;
  const next=cards.map(card=>{
    if(!selected.has(card.id)||!bulkFieldEligible(card,action.field))return card;
    eligible++;
    let change:Patch=patch;
    if(source){
      change={language:source.language,condition:source.condition,variant:source.variant};
      if(!source.giveaway&&!card.giveaway)change={...change,pricingMode:source.pricingMode,startingPrice:source.startingPrice,increment:source.increment,buyout:source.buyout,optionCount:source.optionCount,customValues:source.customValues,customBuyoutLast:source.customBuyoutLast,...(allowDuration?{durationMinutes:source.durationMinutes}:{})};
    }
    const keys=(Object.keys(change) as Array<keyof Settings>).filter(key=>card[key]!==change[key]);
    if(!keys.length)return card;
    const updated={...card,...change};
    if(keys.some(key=>priceKeys.has(key)))validatePricing(updated);
    if(keys.includes("durationMinutes"))decimal(updated.durationMinutes,0.1,10080);
    changes.push({id:card.id,before:Object.fromEntries(keys.map(key=>[key,card[key]])),after:Object.fromEntries(keys.map(key=>[key,change[key]]))});
    return updated;
  });
  if(!eligible)throw new Error("Nenhuma selecionada é compatível com esse campo. Valores automáticos só alteram leilões no modo automático; brindes e quizzes são preservados.");
  return {cards:next,changes,skipped:targets.length-eligible,unchanged:eligible-changes.length};
}

/** Undo only fields still matching this operation, preserving later edits,
 * uploads and reordering. Invalid price combinations are never restored. */
export function undoDraftBulkEdit<T extends BulkEditableCard>(cards:readonly T[],changes:readonly BulkEditChange[]){
  const byId=new Map(changes.map(change=>[change.id,change]));let restored=0,conflicts=0;
  const next=cards.map(card=>{
    const change=byId.get(card.id);if(!change)return card;
    const keys=Object.keys(change.before) as Array<keyof Settings>;
    const safe=keys.filter(key=>card[key]===change.after[key]);conflicts+=keys.length-safe.length;
    if(!safe.length)return card;
    const updated={...card,...Object.fromEntries(safe.map(key=>[key,change.before[key]]))};
    if(safe.some(key=>priceKeys.has(key))){try{validatePricing(updated);}catch{conflicts+=safe.length;return card;}}
    restored++;return updated;
  });
  return {cards:next,restored,conflicts};
}
