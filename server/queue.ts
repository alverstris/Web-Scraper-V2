import { CloudTasksClient } from '@google-cloud/tasks';

export interface TaskPayload {runId:string; batchId:string}
export interface Queue {enqueue(task:TaskPayload):Promise<void>}
export function demoQueueDelay(value:string|undefined):number {
  if(value===undefined)return 1800;
  if(!/^\d+$/.test(value)||!Number.isSafeInteger(Number(value))||Number(value)>10_000)throw new Error('DEMO_QUEUE_DELAY_MS must be an integer from 0 to 10000.');
  return Number(value);
}
export class LocalQueue implements Queue {
  private pending = new Map<string, ReturnType<typeof setTimeout>>();
  constructor(private handler:(task:TaskPayload)=>Promise<void>, private delay=1800) {}
  async enqueue(task:TaskPayload) {
    const key = `${task.runId}-${task.batchId}`;
    if (this.pending.has(key)) return;
    const timer = setTimeout(() => {
      this.pending.delete(key);
      void this.handler(task).catch(() => { /* Reconciliation recovers durable unfinished batches. */ });
    }, this.delay);
    this.pending.set(key,timer);
  }
  close() { for (const timer of this.pending.values()) clearTimeout(timer); this.pending.clear(); }
}
export class CloudTasksQueue implements Queue {
  private client = new CloudTasksClient();
  async enqueue(payload:TaskPayload) {
    const project = process.env.GOOGLE_CLOUD_PROJECT || process.env.FIREBASE_PROJECT_ID;
    const {TASKS_LOCATION,TASKS_QUEUE,WORKER_URL,TASKS_SERVICE_ACCOUNT_EMAIL} = process.env;
    if (!project || !TASKS_LOCATION || !TASKS_QUEUE || !WORKER_URL || !TASKS_SERVICE_ACCOUNT_EMAIL) throw new Error('Cloud Tasks configuration is incomplete.');
    const parent = this.client.queuePath(project,TASKS_LOCATION,TASKS_QUEUE);
    // Firestore leases supply duplicate-delivery protection. A unique task name permits reconciliation after a failed delivery.
    await this.client.createTask({parent,task:{
      httpRequest:{httpMethod:'POST',url:`${WORKER_URL.replace(/\/$/,'')}/internal/batches`,
        headers:{'Content-Type':'application/json'}, body:Buffer.from(JSON.stringify(payload)).toString('base64'),
        oidcToken:{serviceAccountEmail:TASKS_SERVICE_ACCOUNT_EMAIL,audience:WORKER_URL}},
      dispatchDeadline:{seconds:120},
    }});
  }
}
