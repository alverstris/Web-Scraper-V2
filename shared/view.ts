import type { Dataset, FacilityKey, ListingVersion, RouteRow, ViewState } from './contracts';
import { FILTER_LIMITS, transitModeSchema, validateViewState } from './search-filters.ts';

export interface VisibleResult { listing: ListingVersion; route: RouteRow }

const hasDuration=(row:RouteRow)=>row.state==='SUCCESS'&&Number.isFinite(row.durationSeconds)&&row.durationSeconds!>=0;
const hasWalking=(row:RouteRow)=>hasDuration(row)&&Number.isFinite(row.walkingSeconds)&&row.walkingSeconds!>=0&&row.walkingSeconds!<=row.durationSeconds!;
const hasTransfers=(row:RouteRow)=>hasDuration(row)&&Number.isInteger(row.transfers)&&row.transfers!>=0&&row.transfers!<=FILTER_LIMITS.transfers;
const hasTransitModes=(row:RouteRow)=>hasDuration(row)&&!!row.transitModes?.length&&new Set(row.transitModes).size===row.transitModes.length&&row.transitModes.every(mode=>transitModeSchema.safeParse(mode).success);

/** Carry local housing choices to another dataset without retaining unsupported route measures. */
export function applicableViewForDataset(view:ViewState,dataset:Dataset):ViewState {
  const applicable=validateViewState(view),transit=dataset.definition.mode==='TRANSIT';
  const successful=dataset.rows.filter(row=>row.state==='SUCCESS');
  if(!transit||!successful.some(hasWalking))delete applicable.maxWalkingMinutes;
  if(!transit||!successful.some(hasTransfers))delete applicable.maxTransfers;
  if(!transit||!successful.some(hasTransitModes))delete applicable.transitModes;
  if(applicable.sort.startsWith('WALKING_')&&(!transit||!successful.length||!successful.every(hasWalking)))applicable.sort='COMMUTE_ASC';
  if(applicable.selectedId&&!dataset.listings.some(listing=>listing.id===applicable.selectedId))delete applicable.selectedId;
  return applicable;
}

/** Pure dataset-wide view operation. This module has no network/provider dependency. */
export function filterDataset(dataset: Dataset, view: ViewState): VisibleResult[] {
  view=validateViewState(view);
  if(dataset.listings.some(listing=>listing.rent.currency!=='CHF'||listing.rent.period!=='MONTH'))throw new Error('This market requires rent normalized to CHF per month before filtering.');
  if(dataset.definition.mode!=='TRANSIT'&&(view.maxWalkingMinutes!==undefined||view.maxTransfers!==undefined||view.transitModes!==undefined||view.sort.startsWith('WALKING_')))throw new Error('Walking, transfer and transit-type controls require a public transport dataset.');
  const rows = new Map(dataset.rows.map(row => [`${row.listingId}\u0000${row.listingVersion}`, row]));
  const results: VisibleResult[] = [];
  for (const listing of dataset.listings) {
    const route = rows.get(`${listing.id}\u0000${listing.version}`);
    // A progressively delivered listing has no result yet; never invent a route row.
    if (!route) continue;
    const hasDuration = route.state === 'SUCCESS' && Number.isFinite(route.durationSeconds) && route.durationSeconds! >= 0;
    if (!view.includeUnavailable && !hasDuration) continue;
    if(view.locality!==undefined&&listing.locality?.toLocaleLowerCase('en')!==view.locality.toLocaleLowerCase('en'))continue;
    if (view.minRent !== undefined && (listing.rent.amount === null || listing.rent.amount < view.minRent)) continue;
    if (view.maxRent !== undefined && (listing.rent.amount === null || listing.rent.amount > view.maxRent)) continue;
    if (view.minBedrooms !== undefined && (listing.bedrooms === null || listing.bedrooms < view.minBedrooms)) continue;
    if (view.maxBedrooms !== undefined && (listing.bedrooms === null || listing.bedrooms > view.maxBedrooms)) continue;
    if (view.minRooms !== undefined && (listing.rooms === null || listing.rooms < view.minRooms)) continue;
    if (view.maxRooms !== undefined && (listing.rooms === null || listing.rooms > view.maxRooms)) continue;
    if (view.minBathrooms !== undefined && (listing.bathrooms === null || listing.bathrooms < view.minBathrooms)) continue;
    if (view.maxBathrooms !== undefined && (listing.bathrooms === null || listing.bathrooms > view.maxBathrooms)) continue;
    if (view.minArea !== undefined && (listing.floorArea === null || listing.floorArea < view.minArea)) continue;
    if (view.maxArea !== undefined && (listing.floorArea === null || listing.floorArea > view.maxArea)) continue;
    if (view.maxCommuteMinutes !== undefined && (!hasDuration || route.durationSeconds! > view.maxCommuteMinutes * 60)) continue;
    const hasWalking=hasDuration&&Number.isFinite(route.walkingSeconds)&&route.walkingSeconds!>=0&&route.walkingSeconds!<=route.durationSeconds!;
    if(view.maxWalkingMinutes!==undefined&&(!hasWalking||route.walkingSeconds!>view.maxWalkingMinutes*60))continue;
    if(view.maxTransfers!==undefined&&(!hasDuration||!Number.isInteger(route.transfers)||route.transfers!<0||route.transfers!>view.maxTransfers))continue;
    // Selected types are an allowed set: every known type used by the route must fit it.
    if(view.transitModes!==undefined&&(!hasDuration||!route.transitModes?.length||!route.transitModes.every(mode=>view.transitModes!.includes(mode))))continue;
    if (view.furnishing !== undefined && listing.furnishing !== view.furnishing) continue;
    if (view.propertyType !== undefined && listing.propertyType !== view.propertyType) continue;
    if (view.facilities && Object.entries(view.facilities).some(([key, value]) => value !== undefined && listing.facilities[key as FacilityKey] !== value)) continue;
    if (view.bounds) {
      const point = listing.location.point;
      const { north, south, east, west } = view.bounds;
      // West > east denotes a box crossing the international date line.
      if (!point || point.lat < south || point.lat > north ||
          (west <= east ? point.lng < west || point.lng > east : point.lng < west && point.lng > east)) continue;
    }
    results.push({ listing, route });
  }
  if(view.sort.startsWith('WALKING_')&&results.some(result=>result.route.state==='SUCCESS'&&(!Number.isFinite(result.route.walkingSeconds)||result.route.walkingSeconds!<0||result.route.walkingSeconds!>result.route.durationSeconds!)))throw new Error('Walking sort requires known walking time for every successful journey being compared.');
  return results.sort((a, b) => {
    const aSuccess = a.route.state === 'SUCCESS' && Number.isFinite(a.route.durationSeconds)&&a.route.durationSeconds!>=0;
    const bSuccess = b.route.state === 'SUCCESS' && Number.isFinite(b.route.durationSeconds)&&b.route.durationSeconds!>=0;
    if (aSuccess !== bSuccess) return aSuccess ? -1 : 1;
    let difference = 0;
    if (view.sort === 'COMMUTE_ASC' || view.sort === 'COMMUTE_DESC') {
      if (aSuccess && bSuccess) difference = (a.route.durationSeconds! - b.route.durationSeconds!) * (view.sort === 'COMMUTE_ASC' ? 1 : -1);
    } else if(view.sort==='WALKING_ASC'||view.sort==='WALKING_DESC'){
      const known=(result:VisibleResult)=>result.route.state==='SUCCESS'&&Number.isFinite(result.route.walkingSeconds)&&result.route.walkingSeconds!>=0&&result.route.walkingSeconds!<=result.route.durationSeconds!;
      const aKnown=known(a),bKnown=known(b);
      if(aKnown!==bKnown)return aKnown?-1:1;
      if(aKnown&&bKnown)difference=(a.route.walkingSeconds!-b.route.walkingSeconds!)*(view.sort==='WALKING_ASC'?1:-1);
    } else {
      const aRent = a.listing.rent.amount, bRent = b.listing.rent.amount;
      if ((aRent === null) !== (bRent === null)) return aRent === null ? 1 : -1;
      if (aRent !== null && bRent !== null) difference = (aRent - bRent) * (view.sort === 'RENT_ASC' ? 1 : -1);
    }
    // Stable independent of batch arrival order and the browser's locale.
    return difference || (a.listing.id < b.listing.id ? -1 : a.listing.id > b.listing.id ? 1 : 0);
  });
}
