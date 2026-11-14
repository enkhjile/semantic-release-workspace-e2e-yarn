import assert from 'node:assert/strict';
export function assertNeverReuseVersion(history, names, version) {
  assert.equal(history.schemaVersion, 1);
  for (const name of names) {
    assert.ok(history.packages[name], 'Missing immutable publication history');
    assert.ok(!Object.hasOwn(history.packages[name].versions, version), name + '@' + version + ' was published before cleanup and is permanently reserved');
  }
}
export function retainedBootstrap(history, name, version, integrity) {
  const entry = history.packages[name];
  const bootstrap = entry?.retainedBootstrap;
  if (!bootstrap || version !== bootstrap.version) return false;
  assert.equal(version, '1.0.0');
  assert.equal(bootstrap.integrity, entry.versions[version].integrity);
  assert.equal(integrity, bootstrap.integrity, 'Retained bootstrap bytes changed');
  return true;
}
export function assertBaseline(history, name, baseline, inventory) {
  for (const [version, original] of Object.entries(baseline.versions)) {
    if (!(version in inventory.versions) && retainedBootstrap(history, name, version, original.integrity)) continue;
    assert.equal(inventory.versions[version], original.integrity, 'Baseline version changed or disappeared: ' + name + '@' + version);
  }
  for (const [tag, version] of Object.entries(baseline.distTags)) {
    if (tag === 'alpha') continue;
    if (!(version in inventory.versions) && retainedBootstrap(history, name, version, baseline.versions[version]?.integrity)) {
      assert.equal(inventory.tags[tag], undefined, 'Removed bootstrap tag must disappear; retargeting needs an explicit refreshed baseline');
      continue;
    }
    assert.equal(inventory.tags[tag], version, 'Baseline dist-tag changed unexpectedly: ' + tag);
  }
}
export function assertRetiredVersionsAbsent(history, name, inventory, allowBootstrap) {
  for (const [version, integrity] of Object.entries(inventory.versions)) {
    if (!Object.hasOwn(history.packages[name].versions, version)) continue;
    assert.ok(allowBootstrap && retainedBootstrap(history, name, version, integrity), 'Retired version still exists: ' + name + '@' + version);
  }
}
