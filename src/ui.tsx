import { cloneElement, isValidElement, useId, useEffect, useState, type ReactElement, type ReactNode } from 'react';
import type { RouteDefinition, Counts } from '../shared/contracts';

export function Panel({ title, children, id, className = '' }: {title:string;children:ReactNode;id?:string;className?:string}) {
  return <section className={`panel ${className}`} id={id} data-motion-region={id ?? 'panel'}><h2>{title}</h2>{children}</section>;
}
export function Field({ label, children, hint }: {label:string;children:ReactNode;hint?:string}) {
  const id = useId();
  return <div className="field"><label htmlFor={id}>{label}</label>{isValidElement(children) ? cloneElement(children as ReactElement<{id:string;'aria-describedby'?:string}>, {id,'aria-describedby':hint?`${id}-hint`:undefined}) : children}{hint && <small id={`${id}-hint`}>{hint}</small>}</div>;
}
export const modeLabels: Record<RouteDefinition['mode'], string> = {WALK:'Walking',BICYCLE:'Cycling',DRIVE:'Driving',TRANSIT:'Public transport'};
export const preferenceLabels = {DEFAULT:'Default',LESS_WALKING:'Prefer less walking',FEWER_TRANSFERS:'Prefer fewer transfers'};
const transitModeLabels = {BUS:'Bus',SUBWAY:'Metro',TRAIN:'Train',LIGHT_RAIL:'Light rail',RAIL:'Rail'};
export function dateLabel(value: string) { const d = new Date(value); return Number.isNaN(d.valueOf()) ? value : d.toLocaleString(); }
export function DefinitionSummary({definition}: {definition:RouteDefinition}) {
  return <><dl className="facts"><div><dt>Destination</dt><dd>{definition.destination.label} — {definition.destination.context}</dd></div><div><dt>Journey</dt><dd>Home to destination · {modeLabels[definition.mode]}{definition.mode === 'TRANSIT' ? ` · ${preferenceLabels[definition.transitPreference]}` : ''}</dd></div><div><dt>Journey assumption</dt><dd>{definition.timeBasis.kind === 'ARRIVAL' ? 'Arrive' : 'Depart'} {dateLabel(definition.timeBasis.at)} (displayed in your browser timezone; calculation zone: {definition.timeBasis.timezone})</dd></div>{definition.preferredTransitModes.length>0 && <div><dt>Preferred transit modes</dt><dd>{definition.preferredTransitModes.map(mode=>transitModeLabels[mode]).join(', ')} (not guaranteed)</dd></div>}</dl><details><summary>Calculation details</summary><p>Provider: {definition.provider} · adapter {definition.adapterVersion}</p></details></>;
}
export function CountsSummary({counts}: {counts:Counts}) {
  return <p>{counts.completed} / {counts.total} processed · {counts.success} available journeys · {counts.noRoute} no journey found · {counts.unresolved} locations too imprecise · {counts.failed} calculation errors · {Math.max(0,counts.total-counts.completed)} pending</p>;
}

// Future animation adapters consume these semantic regions and this preference.
// Domain state never waits for an animation callback or depends on a transition.
export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => { const media = matchMedia('(prefers-reduced-motion: reduce)'); const update = () => setReduced(media.matches); update(); media.addEventListener('change',update); return () => media.removeEventListener('change',update); },[]);
  return reduced;
}
