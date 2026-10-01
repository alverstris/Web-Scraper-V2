import test from 'node:test';
import assert from 'node:assert/strict';
import { journeyDateInput, parseJourneyDateInput } from '../src/journey-time.ts';

test('Swiss journey inputs preserve the same instant independently of the browser timezone', () => {
  assert.equal(parseJourneyDateInput('2026-10-06T08:30')?.toISOString(), '2026-10-06T06:30:00.000Z');
  assert.equal(parseJourneyDateInput('2026-12-06T08:30')?.toISOString(), '2026-12-06T07:30:00.000Z');
  assert.equal(journeyDateInput('2026-10-06T06:30:00Z'), '2026-10-06T08:30');
});

test('invalid dates, skipped and repeated daylight-saving times cannot silently change a journey', () => {
  for (const value of ['2026-02-30T08:30', '2026-10-06T25:00', '', '2026-03-29T02:30', '2026-10-25T02:30']) {
    assert.equal(parseJourneyDateInput(value), null, value);
  }
  assert.equal(parseJourneyDateInput('2026-03-29T03:30')?.toISOString(), '2026-03-29T01:30:00.000Z');
  assert.equal(parseJourneyDateInput('2026-10-25T03:30')?.toISOString(), '2026-10-25T02:30:00.000Z');
});
