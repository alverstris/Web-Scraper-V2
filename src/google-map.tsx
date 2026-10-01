import {useEffect,useRef,useState} from 'react';
import type {Dataset,ViewState} from '../shared/contracts';
import type {ResultItem} from './worker-client';

// SDK types stay inside the map adapter. No application service depends on Google Maps objects.
type MapsSdk = Record<string,any>;
let loader:Promise<MapsSdk>|undefined;
function loadMaps(key:string):Promise<MapsSdk>{
 if(loader)return loader;
 loader=new Promise((resolve,reject)=>{
  const host=window as unknown as {google?:{maps:MapsSdk};__commuteMapsReady?:()=>void};
  if(host.google?.maps){resolve(host.google.maps);return}
  const script=document.createElement('script');
  const timeout=setTimeout(()=>{script.remove();delete host.__commuteMapsReady;loader=undefined;reject(new Error('Map loading timed out. The property list remains available.'));},20000);
  host.__commuteMapsReady=()=>{clearTimeout(timeout);delete host.__commuteMapsReady;host.google?.maps?resolve(host.google.maps):reject(new Error('Map SDK unavailable.'))};
  const url=new URL('https://maps.googleapis.com/maps/api/js');url.searchParams.set('key',key);url.searchParams.set('loading','async');url.searchParams.set('v','quarterly');url.searchParams.set('callback','__commuteMapsReady');
  script.src=url.href;script.async=true;script.onerror=()=>{clearTimeout(timeout);script.remove();delete host.__commuteMapsReady;loader=undefined;reject(new Error('Map unavailable. Use the property list or retry later.'))};document.head.append(script);
 });return loader;
}
export default function GoogleMap({dataset,items,selectedId,onSelect,onBounds}:{dataset:Dataset;items:ResultItem[];selectedId?:string;onSelect:(id:string)=>void;onBounds:(bounds:ViewState['bounds'])=>void}){
 const container=useRef<HTMLDivElement>(null),map=useRef<any>(null),sdk=useRef<MapsSdk|undefined>(undefined),markers=useRef<{marker:any;id:string}[]>([]),handlers=useRef({onSelect});handlers.current={onSelect};
 const [ready,setReady]=useState(false),[error,setError]=useState('');
 const key=import.meta.env.VITE_GOOGLE_MAPS_BROWSER_KEY as string|undefined,mapId=import.meta.env.VITE_GOOGLE_MAP_ID as string|undefined;
 useEffect(()=>{
  if(!key||!mapId||dataset.synthetic)return;
  let disposed=false;
  void loadMaps(key).then(async maps=>{await Promise.all([maps.importLibrary('maps'),maps.importLibrary('marker')]);if(disposed||!container.current)return;sdk.current=maps;map.current=new maps.Map(container.current,{center:dataset.definition.destination.point,zoom:12,mapId,streetViewControl:false,fullscreenControl:false,gestureHandling:'cooperative'});setReady(true)}).catch(e=>{if(!disposed)setError(e.message)});
  return()=>{disposed=true;for(const m of markers.current)m.marker.map=null;markers.current=[];map.current=null;setReady(false)};
 },[key,mapId,dataset.id,dataset.synthetic]);
 useEffect(()=>{
  if(!ready||!map.current||!sdk.current)return;const maps=sdk.current;
  for(const m of markers.current)m.marker.map=null;markers.current=[];
  const bounds=new maps.LatLngBounds();
  for(const item of items){if(!item.listing.location.point)continue;const p=item.listing.location.point;bounds.extend(p);
   const marker=new maps.marker.AdvancedMarkerElement({map:map.current,position:p,title:`${item.listing.title}; ${item.listing.location.precision.toLowerCase()} origin`,gmpClickable:true});
   marker.addListener('click',()=>handlers.current.onSelect(item.listing.id));markers.current.push({marker,id:item.listing.id});
  }
  const point=dataset.definition.destination.point;if(point){bounds.extend(point);const marker=new maps.marker.AdvancedMarkerElement({map:map.current,position:point,title:`Destination: ${dataset.definition.destination.label}`});markers.current.push({marker,id:'destination'})}
  // Only initially fit: ordinary filtering never pans the map or changes the routing universe.
  if(!map.current.__commuteFitted&&!bounds.isEmpty()){map.current.fitBounds(bounds,36);map.current.__commuteFitted=true}
 },[ready,items,dataset.definition.destination]);
 useEffect(()=>{for(const entry of markers.current){entry.marker.zIndex=entry.id===selectedId?100:1;entry.marker.element?.setAttribute('aria-pressed',String(entry.id===selectedId))}},[selectedId,ready,items]);
 if(dataset.synthetic)return null;
 if(!key||!mapId)return <p>The live map needs a restricted browser map key and map ID. Search results remain available in the list.</p>;
 return <section aria-label="Property locations"><p>Markers show property locations and their stated precision. No route geometry or commute contours are drawn.</p>{error&&<p role="alert">{error}</p>}<div ref={container} className="map-plot" aria-label="Google map of property locations"/><button disabled={!ready} onClick={()=>{const b=map.current?.getBounds();if(b)onBounds({north:b.getNorthEast().lat(),east:b.getNorthEast().lng(),south:b.getSouthWest().lat(),west:b.getSouthWest().lng()})}}>Use visible map area as a property filter</button><p>Panning alone does not filter properties or calculate routes.</p></section>;
}
