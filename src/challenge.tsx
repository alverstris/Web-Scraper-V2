import { useEffect, useRef, useState } from 'react';

type Turnstile = {render:(element:HTMLElement,options:Record<string,unknown>)=>string;remove:(id:string)=>void};
let ready:Promise<Turnstile>|undefined;
function loadWidget():Promise<Turnstile> {
  if(ready)return ready;
  ready=new Promise<Turnstile>((resolve,reject)=>{
    const scope=window as unknown as {turnstile?:Turnstile};
    if(scope.turnstile){resolve(scope.turnstile);return;}
    const script=document.createElement('script');
    script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async=true;
    script.onload=()=>scope.turnstile?resolve(scope.turnstile):reject(new Error('The verification service did not load.'));
    script.onerror=()=>reject(new Error('Verification could not load. Check your connection and try again.'));
    document.head.appendChild(script);
  }).catch(error=>{ready=undefined;throw error;});
  return ready;
}

export function RunChallenge({onToken,resetKey}:{onToken:(token:string|null)=>void;resetKey:number}) {
  const ref=useRef<HTMLDivElement>(null);
  const [error,setError]=useState('');
  const siteKey=import.meta.env.VITE_TURNSTILE_SITE_KEY as string|undefined;
  useEffect(()=>{
    if(!siteKey)return;
    let cancelled=false;let widgetId:string|undefined;let widget:Turnstile|undefined;
    onToken(null);setError('');
    loadWidget().then(api=>{
      if(cancelled||!ref.current)return;
      widget=api;
      widgetId=api.render(ref.current,{sitekey:siteKey,action:'custom-run',callback:(value:string)=>onToken(value),'expired-callback':()=>onToken(null),'error-callback':()=>{onToken(null);setError('Verification expired or failed. Please complete the challenge again.');}});
    }).catch(e=>{if(!cancelled)setError(e instanceof Error?e.message:'Verification unavailable.');});
    return()=>{cancelled=true;if(widget&&widgetId)widget.remove(widgetId);onToken(null);};
  },[siteKey,resetKey,onToken]);
  return <section aria-label="Custom run verification"><p>Complete the anti-abuse check before starting this calculation.</p>{siteKey?<div ref={ref}/>:<p>Custom-run verification is unavailable until the site key is configured.</p>}{error&&<p role="alert">{error}</p>}</section>;
}
