import {test} from 'node:test';
import assert from 'node:assert/strict';
import {assertIntent, assertAddedVersions} from './live-cycle-alpha7.mjs';
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
test('retry counts only missing reviewed targets and rejects unexpected public additions', () => {
  const core = {name: 'core', version: '1.1.0-alpha7.1'}, app = {name: 'app', version: '1.1.0-alpha7.1'};
  const before = {core: {versions: {[core.version]: 'retained-integrity'}}, app: {versions: {}}};
  assert.doesNotThrow(() => assertAddedVersions([app], [core, app], before));
  assert.doesNotThrow(() => assertAddedVersions([], [core, app], {...before, app: {versions: {[app.version]: 'retained-integrity'}}}));
  assert.throws(() => assertAddedVersions([core, app], [core, app], before));
  assert.throws(() => assertAddedVersions([app, {name: 'foreign', version: '2.0.0'}], [core, app], before));
});
