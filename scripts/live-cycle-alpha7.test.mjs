import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assertIntent} from './live-cycle-alpha7.mjs';
const intent = {branch: 'alpha7-live', expected: [{name: 'core', version: '1.1.0-alpha7.1'}]};
const plan = {head: 'source', release: {branch: intent.branch}, packages: [{name: 'core', nextVersion: '1.1.0-alpha7.1'}]};
test('public release guard rejects unreviewed versions and package identities', () => {
  assert.doesNotThrow(() => assertIntent(plan, intent, 'source'));
  assert.throws(() => assertIntent({...plan, packages: [{name: 'core', nextVersion: '1.2.0'}]}, intent, 'source'));
  assert.throws(() => assertIntent({...plan, packages: [{name: 'foreign', nextVersion: '1.1.0-alpha7.1'}]}, intent, 'source'));
});
test('public release guard rejects another branch or source', () => {
  assert.throws(() => assertIntent({...plan, release: {branch: 'stable7-live'}}, intent, 'source'));
  assert.throws(() => assertIntent(plan, intent, 'another-source'));
});
test('covered backmerge intent allows no public version and rejects a release plan', () => {
  assert.doesNotThrow(() => assertIntent({packages: []}, {branch: 'alpha7-live', expected: []}, 'source'));
  assert.throws(() => assertIntent(plan, {branch: 'alpha7-live', expected: []}, 'source'));
});
