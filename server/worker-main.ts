import { createRuntime } from './runtime.ts';
import { createApiServer } from './http.ts';
if(process.env.APP_MODE!=='live')throw new Error('A separate worker requires live Firestore storage. Local demo workers run inside the API process.');
const runtime=await createRuntime();
const server=createApiServer(runtime.service,{workerOnly:true});
server.listen(Number(process.env.PORT??8080),'0.0.0.0');
process.on('SIGTERM',()=>{runtime.close();server.close();});
