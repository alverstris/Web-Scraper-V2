/** Commercial hooks do not contain prices, invented partners or sponsored inventory. */
export interface Partner {
 id:string;sourceId:string;enabled:boolean;agreementReference:string;expiresAt:string;
 allowedHosts:string[];
 referral?:{baseUrl:string;listingParameter:string;fixedParameters:Record<string,string>};
 disclosure:string;
}
export type AdSlotName='results-inline'|'desktop-side';
export interface AdPlacementConfig {enabled:boolean;slots:AdSlotName[];consentRequired:boolean;approved:boolean}
export interface AdProvider {
 id:string;
 mount(container:HTMLElement,context:{slot:AdSlotName;consent:'GRANTED'|'DENIED'|'UNKNOWN'}):Promise<()=>void>;
}
