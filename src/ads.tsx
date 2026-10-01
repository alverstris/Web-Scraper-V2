import {useEffect,useRef,useState} from 'react';
import type {AdProvider,AdPlacementConfig,AdSlotName} from '../shared/commercial';
/** Mount lifecycle is slot/provider/consent-scoped, never tied to filters, progress or ranking. */
export function AdPlacement({slot,config,provider,consent='UNKNOWN',preview=false}:{slot:AdSlotName;config:AdPlacementConfig;provider?:AdProvider;consent?:'GRANTED'|'DENIED'|'UNKNOWN';preview?:boolean}){
 const container=useRef<HTMLDivElement>(null),[unavailable,setUnavailable]=useState(false);
 const enabled=config.enabled&&config.approved&&config.slots.includes(slot)&&(!config.consentRequired||consent==='GRANTED');
 useEffect(()=>{if(!enabled||!provider||!container.current)return;let active=true,cleanup:(()=>void)|undefined;setUnavailable(false);
  provider.mount(container.current,{slot,consent}).then(fn=>{if(active)cleanup=fn;else fn()}).catch(()=>{if(active)setUnavailable(true)});
  return()=>{active=false;cleanup?.()};
 },[enabled,provider,slot,consent]);
 if(preview)return <aside className="ad-slot" aria-label="Advertisement development placeholder"><p>Advertisement — development placeholder</p><p>No ad network is loaded.</p></aside>;
 if(!enabled||!provider)return null;
 return <aside className="ad-slot" aria-label="Advertisement"><p>Advertisement</p><div ref={container}/>{unavailable&&<p>Advertisement unavailable.</p>}</aside>;
}
