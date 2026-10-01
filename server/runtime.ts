import { resolve } from 'node:path';
import { FileRepository,FileBlobStore,FirestoreRepository,GcsBlobStore } from './storage.ts';
import { createProviders } from './providers/index.ts';
import { CommuteService } from './service.ts';
import { CloudTasksQueue,LocalQueue,demoQueueDelay } from './queue.ts';
import { readLivePolicy } from './config.ts';
import type { ListingProvider,LocationResolver,RouteProvider } from '../shared/contracts.ts';
export async function createRuntime() {
  const mode=process.env.APP_MODE??'demo';if(mode!=='demo'&&mode!=='live')throw new Error('APP_MODE must be demo or live.');
  if(mode==='demo'&&process.env.K_SERVICE)throw new Error('The local demo must not run on Cloud Run; use live mode with isolated staging configuration.');
  const dataDir=resolve(process.env.DATA_DIR??'.data');
  const repo=mode==='demo'?new FileRepository(dataDir):new FirestoreRepository(process.env.FIREBASE_PROJECT_ID??process.env.GOOGLE_CLOUD_PROJECT);
  if(mode==='live'&&!process.env.GCS_BUCKET)throw new Error('GCS_BUCKET is required in live mode.');
  const blobs=mode==='demo'?new FileBlobStore(resolve(dataDir,'blobs')):new GcsBlobStore(process.env.GCS_BUCKET!);
  let providers:{route:RouteProvider;location:LocationResolver;listings:ListingProvider[]};let providerAvailable=true;
  try{providers=createProviders(mode);}catch(error){
    if(mode==='demo')throw error;providerAvailable=false;
    process.stderr.write(JSON.stringify({event:'live_providers_gated',category:'configuration_required'})+'\n');
    const blocked=async()=>{throw new Error('Live providers are not configured and approved.');};
    providers={route:{id:'google',version:'unavailable',maxBatchSize:25,route:blocked},location:{search:blocked},listings:[]};
  }
  const policy=mode==='live'?readLivePolicy():undefined;
  const service=new CommuteService({mode,repo,blobs,...providers,queue:{enqueue:async()=>{}},livePolicy:providerAvailable?policy:undefined,
    ttlMs:policy?policy.retentionHours*3600_000:undefined,maxCandidates:policy?.maxCandidates});
  const queue=mode==='demo'?new LocalQueue(task=>service.processBatch(task),demoQueueDelay(process.env.DEMO_QUEUE_DELAY_MS)):new CloudTasksQueue();service.queue=queue;
  await service.initialise();
  return {mode,service,repo,blobs,providers,close:()=>{if(queue instanceof LocalQueue)queue.close();}};
}
