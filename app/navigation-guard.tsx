"use client";
import Link from "next/link";
import {useRouter} from "next/navigation";
import {createContext,useCallback,useContext,useEffect,useMemo,useRef,useState,type ComponentProps,type ReactNode,type RefObject} from "react";
import {shouldGuardNavigation} from "../lib/navigation-guard";

type Guard={isDirty:()=>boolean;isBusy:()=>boolean;message:()=>string;save?:()=>Promise<boolean>};
type Context={register:(guard:RefObject<Guard>)=>()=>void;request:(href:string)=>boolean};
const NavigationContext=createContext<Context|null>(null);

export function NavigationGuardProvider({children}:{children:ReactNode}){
  const router=useRouter();
  const guard=useRef<RefObject<Guard>|null>(null);
  const [destination,setDestination]=useState<string|null>(null);
  const [saving,setSaving]=useState(false),[error,setError]=useState("");
  const dialog=useRef<HTMLDialogElement>(null);
  const skipUnload=useRef(false);
  const register=useCallback((entry:RefObject<Guard>)=>{
    guard.current=entry;
    return()=>{if(guard.current===entry){guard.current=null;setDestination(null);}};
  },[]);
  const request=useCallback((href:string)=>{
    const current=guard.current?.current;
    if(!current||(!current.isDirty()&&!current.isBusy()))return false;
    setError("");setDestination(href);return true;
  },[]);
  useEffect(()=>{
    const beforeUnload=(event:BeforeUnloadEvent)=>{
      const current=guard.current?.current;
      if(!skipUnload.current&&current&&(current.isDirty()||current.isBusy())){event.preventDefault();event.returnValue="";}
    };
    window.addEventListener("beforeunload",beforeUnload);
    return()=>window.removeEventListener("beforeunload",beforeUnload);
  },[]);
  useEffect(()=>{if(destination&&dialog.current&&!dialog.current.open)dialog.current.showModal();},[destination]);
  const leave=(href:string)=>{
    setDestination(null);skipUnload.current=true;
    // Next's push is client-side. The one-turn exception also supports a
    // browser fallback to document navigation after explicit confirmation.
    try{router.push(href);}finally{setTimeout(()=>{skipUnload.current=false;},0);}
  };
  async function proceed(save:boolean){
    const current=guard.current?.current,href=destination;
    if(!current||!href||saving)return;
    if(current.isBusy()){setError("Aguarde o salvamento ou envio em andamento antes de sair.");return;}
    if(!current.isDirty()){leave(href);return;}
    if(!save){leave(href);return;}
    if(!current.save)return;
    setSaving(true);setError("");
    try{
      const complete=await current.save();
      if(complete)leave(href);
      else setError("O rascunho não foi salvo por completo. Continue editando para conferir as alterações e as fotos pendentes.");
    }catch{setError("Não foi possível salvar o rascunho. Suas alterações continuam nesta página.");}
    finally{setSaving(false);}
  }
  const value=useMemo(()=>({register,request}),[register,request]);
  return <NavigationContext.Provider value={value}>{children}{destination&&<dialog ref={dialog} className="panel modal" aria-labelledby="unsaved-navigation-title" aria-describedby="unsaved-navigation-description" onCancel={event=>{if(saving)event.preventDefault();else setDestination(null);}}>
    <h2 id="unsaved-navigation-title">Sair da criação do leilão?</h2>
    <p id="unsaved-navigation-description">{guard.current?.current.message()}</p>
    {error&&<p role="alert" className="alert">{error}</p>}
    <div className="actions"><button autoFocus disabled={saving} onClick={()=>setDestination(null)}>Continuar editando</button>{guard.current?.current.save&&<button className="secondary" disabled={saving} onClick={()=>void proceed(true)}>{saving?"Salvando rascunho…":"Salvar rascunho e sair"}</button>}<button className="danger-btn" disabled={saving} onClick={()=>void proceed(false)}>Sair sem salvar alterações</button></div>
  </dialog>}</NavigationContext.Provider>;
}

export function useNavigationGuard(options:Guard){
  const context=useContext(NavigationContext);
  if(!context)throw new Error("navigation_guard_provider_missing");
  const optionsRef=useRef(options);optionsRef.current=options;
  useEffect(()=>context.register(optionsRef),[context]);
}

export function GuardedLink({onClick,...props}:ComponentProps<typeof Link>){
  const context=useContext(NavigationContext);
  return <Link {...props} onClick={event=>{
    onClick?.(event);
    const anchor=event.currentTarget;
    if(shouldGuardNavigation({href:anchor.href,current:window.location.href,button:event.button,modified:event.metaKey||event.ctrlKey||event.shiftKey||event.altKey,prevented:event.defaultPrevented,target:anchor.target,download:anchor.hasAttribute("download")})&&context?.request(anchor.pathname+anchor.search+anchor.hash))event.preventDefault();
  }}/>;
}
