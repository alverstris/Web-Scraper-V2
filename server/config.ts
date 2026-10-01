import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { routeDefinitionSchema,safeIdentifier,safeText } from '../shared/validation.ts';

const policySchema=z.object({
  approvalReference:z.string().min(5),approvedAt:z.iso.datetime({offset:true}),expiresAt:z.iso.datetime({offset:true}),
  markets:z.array(z.object({id:z.string().regex(/^[a-z0-9-]+$/),label:z.string().min(1),coverage:z.string().min(10)}).strict()).min(1),
  retentionHours:z.number().positive().max(168),maxCandidates:z.number().int().min(1).max(1000),
  allowCustomRuns:z.boolean(),allowPopular:z.boolean(),allowExport:z.literal(false),
  popularApprovalReference:safeText.min(5).optional(),
  popularPlans:z.array(z.object({id:safeIdentifier,name:safeText.min(1),definition:routeDefinitionSchema,marketId:safeIdentifier,refreshPolicy:safeText.min(5)}).strict()).max(20).default([]),
  accountingPolicy:z.literal('RESERVE_THEN_FINALISE_ON_EXTERNAL_WORK'),precisionPolicy:z.literal('EXCLUDE_APPROXIMATE'),timePolicy:z.literal('EXPLICIT_INSTANT'),
}).strict().superRefine((policy,ctx)=>{
  if(policy.allowPopular&&(!policy.popularApprovalReference||!policy.popularPlans.length))ctx.addIssue({code:'custom',message:'Popular precomputation needs its own permission reference and explicit profiles.'});
  for(const plan of policy.popularPlans)if(plan.definition.provider!=='google'||!policy.markets.some(m=>m.id===plan.marketId))ctx.addIssue({code:'custom',message:'Popular profiles need the approved live provider and a configured market.'});
});
export type LivePolicy=z.infer<typeof policySchema>;
export function readLivePolicy():LivePolicy|undefined {
  if(!process.env.POLICY_CONFIG_PATH)return undefined;
  const policy=policySchema.parse(JSON.parse(readFileSync(process.env.POLICY_CONFIG_PATH,'utf8')));
  if(Date.parse(policy.expiresAt)<=Date.now()||Date.parse(policy.approvedAt)>Date.now())throw new Error('The live policy review is expired or future-dated.');
  return policy;
}
