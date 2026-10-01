/// <reference lib="webworker" />
import { filterDataset } from '../shared/view';
import { exportSnapshot, importSnapshot } from '../shared/portable';
import type { Dataset, ViewState } from '../shared/contracts';

let dataset: Dataset | null = null;
self.onmessage = (event: MessageEvent<{ id: number; type: 'set'|'filter'|'import'|'export'; dataset?: Dataset; view?: ViewState; text?: string }>) => {
  const { id, type } = event.data;
  try {
    if (type === 'set') { dataset = event.data.dataset!; self.postMessage({ id, value: true }); }
    else if (type === 'filter') {
      if (!dataset) throw new Error('No search results are loaded.');
      self.postMessage({ id, value: filterDataset(dataset, event.data.view!) });
    } else if (type === 'import') {
      const imported = importSnapshot(event.data.text!);
      self.postMessage({ id, value: imported });
    } else if (type === 'export') {
      if (!dataset) throw new Error('No search results are loaded.');
      self.postMessage({ id, value: exportSnapshot(dataset) });
    }
  } catch (error) { self.postMessage({ id, error: error instanceof Error ? error.message : 'This operation failed.' }); }
};
