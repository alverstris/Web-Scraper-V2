import { createRuntime } from './runtime.ts';
import { ingestSources } from './ingestion.ts';
const runtime=await createRuntime();
try {
  const command=process.argv[2];
  if(command==='ingest')console.log(JSON.stringify(await ingestSources(runtime.repo,runtime.providers.listings)));
  else if(command==='cleanup'){console.log(JSON.stringify(await runtime.service.cleanup()));await runtime.service.reconcile();}
  else if(command==='popular'){await runtime.service.maintainPopular();console.log(JSON.stringify({published:true}));}
  else throw new Error('Use ingest, cleanup, or popular.');
}finally{runtime.close();}
