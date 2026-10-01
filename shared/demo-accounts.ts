import type { DemoScenario } from './contracts.ts';

// Local test identities are independent of live authentication and never grant live access.
export const demoAccounts: DemoScenario[] = [
  {id:'alice',label:'Alice — eligible account',description:'Two daily custom runs for up to two destinations.'},
  {id:'bob',label:'Bob — separate account',description:'Independent allowance and private results, even for the same destination.'},
  {id:'new',label:'New account',description:'First local sign-in receives a synthetic allowance. Verification is deferred.'},
  {id:'exhausted',label:'Daily runs used',description:'No runs remain today; public profiles and saved snapshots still work.'},
  {id:'destination-limit',label:'Destination limit reached',description:'Two runs remain for EPFL east; a new destination is unavailable today.'},
  {id:'suspended',label:'Account needs support',description:'Custom runs are suspended. Public browsing and account support remain available.'},
  {id:'admin',label:'Administrator',description:'Operational controls and account support review.'},
];
