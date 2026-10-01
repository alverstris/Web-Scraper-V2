import { z } from 'zod';
import type { ViewState } from './contracts.ts';

/** Shared market units and bounds for feeds, snapshots and local view controls. */
export const FILTER_LIMITS = Object.freeze({ rent: 100_000, area: 10_000, rooms: 40, bedrooms: 20, bathrooms: 20, commuteMinutes: 1440, walkingMinutes: 1440, transfers: 20 });
const bounded = (maximum: number) => z.number().finite().min(0).max(maximum);
export const housingValueSchemas = {
  rent: bounded(FILTER_LIMITS.rent), area: bounded(FILTER_LIMITS.area),
  rooms: bounded(FILTER_LIMITS.rooms).multipleOf(0.5), bedrooms: bounded(FILTER_LIMITS.bedrooms).int(), bathrooms: bounded(FILTER_LIMITS.bathrooms).int(),
};
export const propertyTypeSchema = z.enum(['STUDIO','APARTMENT','HOUSE','ROOM','UNKNOWN']);
export const furnishingSchema = z.enum(['FURNISHED','UNFURNISHED','PARTIAL','UNKNOWN']);
export const facilitySchema = z.enum(['PRIVATE','SHARED','ABSENT','UNKNOWN','REVIEW']);
export const transitModeSchema = z.enum(['BUS','SUBWAY','TRAIN','LIGHT_RAIL','RAIL']);
export const localitySchema = z.string().trim().min(1).max(120).refine(value => !/[<>\u0000-\u001f\u007f]/.test(value), 'Use a named area without markup or control characters.');

export const FILTER_OPTIONS = {
  propertyTypes: [{value:'STUDIO',label:'Studio'},{value:'APARTMENT',label:'Apartment'},{value:'HOUSE',label:'House'},{value:'ROOM',label:'Room'},{value:'UNKNOWN',label:'Not stated'}],
  furnishing: [{value:'FURNISHED',label:'Furnished'},{value:'UNFURNISHED',label:'Unfurnished'},{value:'PARTIAL',label:'Partly furnished'},{value:'UNKNOWN',label:'Not stated'}],
  facilities: [{value:'PRIVATE',label:'Private'},{value:'SHARED',label:'Shared'},{value:'ABSENT',label:'Absent'},{value:'UNKNOWN',label:'Not stated'},{value:'REVIEW',label:'Needs review'}],
  transitModes: [{value:'BUS',label:'Bus'},{value:'SUBWAY',label:'Metro'},{value:'TRAIN',label:'Train'},{value:'LIGHT_RAIL',label:'Light rail'},{value:'RAIL',label:'Rail'}],
  sorts: [{value:'COMMUTE_ASC',label:'Shortest commute'},{value:'COMMUTE_DESC',label:'Longest commute'},{value:'RENT_ASC',label:'Lowest rent'},{value:'RENT_DESC',label:'Highest rent'},{value:'WALKING_ASC',label:'Least walking'},{value:'WALKING_DESC',label:'Most walking'}],
  rent: [0,500,750,900,1000,1250,1500,1750,2000,2500,3000,4000,5000],
  rooms: [0,1,1.5,2,2.5,3,3.5,4,4.5,5,6,8], bedrooms: [0,1,2,3,4,5,6], bathrooms: [0,1,2,3,4],
  area: [0,20,30,40,50,60,75,100,125,150,200], commuteMinutes: [5,10,15,20,25,30,40,45,60,90,120],
  walkingMinutes: [0,5,10,15,20,30], transfers: [0,1,2,3,4],
} as const;

export const viewStateSchema = z.object({
  locality: localitySchema.optional(), minRent: housingValueSchemas.rent.optional(), maxRent: housingValueSchemas.rent.optional(),
  minRooms: housingValueSchemas.rooms.optional(), maxRooms: housingValueSchemas.rooms.optional(),
  minBedrooms: housingValueSchemas.bedrooms.optional(), maxBedrooms: housingValueSchemas.bedrooms.optional(),
  minBathrooms: housingValueSchemas.bathrooms.optional(), maxBathrooms: housingValueSchemas.bathrooms.optional(),
  minArea: housingValueSchemas.area.optional(), maxArea: housingValueSchemas.area.optional(),
  maxCommuteMinutes: bounded(FILTER_LIMITS.commuteMinutes).int().optional(), maxWalkingMinutes: bounded(FILTER_LIMITS.walkingMinutes).int().optional(),
  maxTransfers: bounded(FILTER_LIMITS.transfers).int().optional(),
  transitModes: z.array(transitModeSchema).max(5).refine(values => new Set(values).size === values.length, 'Transit types must be unique.').optional(),
  furnishing: furnishingSchema.optional(), propertyType: propertyTypeSchema.optional(),
  facilities: z.object({washingMachine:facilitySchema.optional(),dryer:facilitySchema.optional(),kitchen:facilitySchema.optional(),dishwasher:facilitySchema.optional(),airConditioning:facilitySchema.optional(),balcony:facilitySchema.optional(),parking:facilitySchema.optional()}).strict().optional(),
  bounds: z.object({north:z.number().finite().min(-90).max(90),south:z.number().finite().min(-90).max(90),east:z.number().finite().min(-180).max(180),west:z.number().finite().min(-180).max(180)}).strict().refine(value => value.south <= value.north, 'South must not exceed north.').optional(),
  sort: z.enum(['COMMUTE_ASC','COMMUTE_DESC','RENT_ASC','RENT_DESC','WALKING_ASC','WALKING_DESC']), includeUnavailable:z.boolean(),
  selectedId:z.string().min(1).max(200).refine(value => !/[<>\u0000-\u001f\u007f]/.test(value)).optional(),
}).strict().superRefine((value,ctx) => {
  for (const [minimum,maximum] of [['minRent','maxRent'],['minRooms','maxRooms'],['minBedrooms','maxBedrooms'],['minBathrooms','maxBathrooms'],['minArea','maxArea']] as const) {
    if (value[minimum] !== undefined && value[maximum] !== undefined && value[minimum]! > value[maximum]!) ctx.addIssue({code:'custom',path:[minimum],message:'The minimum must not exceed the maximum.'});
  }
});

export function validateViewState(value: unknown): ViewState { return viewStateSchema.parse(value); }
