import type { Dataset, FacilityKey, ListingVersion, RouteRow, ViewState } from './contracts';

export interface VisibleResult { listing: ListingVersion; route: RouteRow }

/** Pure dataset-wide view operation. This module has no network/provider dependency. */
export function filterDataset(dataset: Dataset, view: ViewState): VisibleResult[] {
  const rows = new Map(dataset.rows.map(row => [`${row.listingId}\u0000${row.listingVersion}`, row]));
  const results: VisibleResult[] = [];
  for (const listing of dataset.listings) {
    const route = rows.get(`${listing.id}\u0000${listing.version}`);
    // A progressively delivered listing has no result yet; never invent a route row.
    if (!route) continue;
    const hasDuration = route.state === 'SUCCESS' && Number.isFinite(route.durationSeconds) && route.durationSeconds! >= 0;
    if (!view.includeUnavailable && !hasDuration) continue;
    if (view.maxRent !== undefined && (listing.rent.amount === null || listing.rent.amount > view.maxRent)) continue;
    if (view.minBedrooms !== undefined && (listing.bedrooms === null || listing.bedrooms < view.minBedrooms)) continue;
    if (view.minRooms !== undefined && (listing.rooms === null || listing.rooms < view.minRooms)) continue;
    if (view.minBathrooms !== undefined && (listing.bathrooms === null || listing.bathrooms < view.minBathrooms)) continue;
    if (view.minArea !== undefined && (listing.floorArea === null || listing.floorArea < view.minArea)) continue;
    if (view.maxCommuteMinutes !== undefined && (!hasDuration || route.durationSeconds! > view.maxCommuteMinutes * 60)) continue;
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
  return results.sort((a, b) => {
    const aSuccess = a.route.state === 'SUCCESS' && Number.isFinite(a.route.durationSeconds);
    const bSuccess = b.route.state === 'SUCCESS' && Number.isFinite(b.route.durationSeconds);
    if (aSuccess !== bSuccess) return aSuccess ? -1 : 1;
    let difference = 0;
    if (view.sort === 'COMMUTE_ASC' || view.sort === 'COMMUTE_DESC') {
      if (aSuccess && bSuccess) difference = (a.route.durationSeconds! - b.route.durationSeconds!) * (view.sort === 'COMMUTE_ASC' ? 1 : -1);
    } else {
      const aRent = a.listing.rent.amount, bRent = b.listing.rent.amount;
      if ((aRent === null) !== (bRent === null)) return aRent === null ? 1 : -1;
      if (aRent !== null && bRent !== null) difference = (aRent - bRent) * (view.sort === 'RENT_ASC' ? 1 : -1);
    }
    // Stable independent of batch arrival order and the browser's locale.
    return difference || (a.listing.id < b.listing.id ? -1 : a.listing.id > b.listing.id ? 1 : 0);
  });
}
