import type { Dataset, ViewState, ListingVersion, RouteRow } from '../shared/contracts';

export type ResultItem = {listing: ListingVersion; route: RouteRow};
export class DatasetWorker {
  private worker = new Worker(new URL('./dataset.worker.ts', import.meta.url), { type: 'module' });
  private nextId = 0;
  private requests = new Map<number, {resolve:(value: unknown)=>void; reject:(error: Error)=>void}>();
  constructor() {
    this.worker.onmessage = event => {
      const request = this.requests.get(event.data.id);
      this.requests.delete(event.data.id);
      if (event.data.error) request?.reject(new Error(event.data.error)); else request?.resolve(event.data.value);
    };
    this.worker.onerror = () => {
      for (const request of this.requests.values()) request.reject(new Error('The local results worker stopped. Reload the page to restart it.'));
      this.requests.clear();
    };
  }
  private request<T>(type: string, payload: Record<string,unknown> = {}): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      this.requests.set(id, {resolve: value => resolve(value as T), reject});
      this.worker.postMessage({ id, type, ...payload });
    });
  }
  set(dataset: Dataset) { return this.request<boolean>('set', {dataset}); }
  filter(view: ViewState) { return this.request<ResultItem[]>('filter', {view}); }
  import(text: string) { return this.request<Dataset>('import', {text}); }
  export() { return this.request<string>('export'); }
  dispose() {
    this.worker.terminate();
    for (const request of this.requests.values()) request.reject(new Error('Results worker closed.'));
    this.requests.clear();
  }
}
