import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parsePlan} from './live-plan.mjs';
import {registryJson} from './registry-read.mjs';

export function assertIntent(plan, intent, head) {
  assert.deepEqual(plan.packages.filter(p => !p.private && p.nextVersion).map(p => ({name: p.name, version: p.nextVersion})).sort((a,b) => a.name.localeCompare(b.name)), [...intent.expected].sort((a,b) => a.name.localeCompare(b.name)));
  if (plan.release) assert.equal(plan.release.branch, intent.branch);
  if (plan.head) assert.equal(plan.head, head);
}

export function assertAddedVersions(added, expected, inventory) {
  const expectedAdded = expected.filter(p => !(p.version in inventory[p.name].versions));
  assert.deepEqual([...added].sort((a,b) => a.name.localeCompare(b.name)), expectedAdded.sort((a,b) => a.name.localeCompare(b.name)), 'Unexpected public version delta');
}

async function main() {
  const intent = JSON.parse(readFileSync('alpha7-live-intent.json'));
  const root = JSON.parse(readFileSync('package.json'));
  const manager = root.packageManager?.split('@')[0] ?? 'npm';
  assert.ok(['npm', 'pnpm', 'yarn'].includes(manager));
  assert.equal(root.devDependencies['semantic-release-workspace'], '1.0.0-alpha.7');
  assert.equal(process.env.GITHUB_EVENT_NAME, 'push');
  assert.equal(process.env.GITHUB_REF_NAME, intent.branch);
  assert.ok(['publish', 'no-change'].includes(intent.mode));
  assert.ok(intent.expected.length <= 2);
  if (intent.mode === 'no-change') assert.equal(intent.expected.length, 0);
  for (const name of ['NPM_TOKEN', 'NODE_AUTH_TOKEN']) assert.ok(!process.env[name], `${name} must be absent`);
  assert.equal(execFileSync('npm', ['--version'], {encoding: 'utf8'}).trim(), '12.2.1');
  const git = (...args) => execFileSync('git', args, {encoding: 'utf8'});
  const head = git('rev-parse', 'HEAD').trim();
  assert.equal(head, process.env.GITHUB_SHA);
  const directory = 'evidence/live-alpha7-cycle';
  mkdirSync(directory, {recursive: true});
  const save = (name, value) => writeFileSync(`${directory}/${name}.json`, JSON.stringify(value, null, 2) + '\n');
  const names = ['core', 'app'].map(part => JSON.parse(readFileSync(`live/${part}/package.json`)).name);
  assert.equal(new Set(names).size, 2);
  assert.ok(intent.expected.every(p => names.includes(p.name) && typeof p.version === 'string'));
  async function snapshot(ready = false) {
    const inventory = {};
    for (const name of names) {
      const candidate = intent.expected.find(p => p.name === name);
      const metadata = await registryJson(`https://registry.npmjs.org/${encodeURIComponent(name)}`, {ready: value => !ready || !candidate || !!value.versions?.[candidate.version] && value['dist-tags']?.[intent.channel] === candidate.version});
      inventory[name] = {tags: metadata['dist-tags'], versions: Object.fromEntries(Object.entries(metadata.versions).map(([version, entry]) => [version, entry.dist.integrity]))};
    }
    return {head: git('rev-parse', 'HEAD').trim(), status: git('status', '--porcelain'), source: git('ls-files', '-z').split('\0').filter(Boolean).map(path => ({path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex')})), refs: git('ls-remote', '--refs', 'origin').trim().split('\n').sort(), inventory};
  }
  function run(label, dryRun = false, readonly = false) {
    const audit = resolve(`${directory}/${label}-http.jsonl`);
    writeFileSync(audit, '');
    const args = manager === 'npm' ? ['exec', '--', 'semantic-release'] : ['exec', 'semantic-release'];
    if (dryRun) args.push('--dry-run');
    const child = spawnSync(manager, args, {encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, env: {...process.env, NODE_OPTIONS: [process.env.NODE_OPTIONS, '--import=' + pathToFileURL(resolve('scripts/network-count.mjs')).href].filter(Boolean).join(' '), SRW_HTTP_AUDIT: audit}});
    const output = (child.stdout ?? '') + (child.stderr ?? '');
    writeFileSync(`${directory}/${label}.log`, output);
    process.stdout.write(output);
    assert.equal(child.status, 0, `${label} real semantic-release failed`);
    assert.ok(output.includes(`Run automated release from branch ${intent.branch}`), 'CLI must select the intended branch');
    const calls = readFileSync(audit, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
    assert.ok(calls.some(call => call.transport === 'observer'));
    if (readonly) for (const call of calls.filter(call => call.transport !== 'observer')) {
      assert.ok(['GET', 'HEAD', 'OPTIONS'].includes(call.method), JSON.stringify(call));
      assert.ok(!/actions\.githubusercontent|token\.actions|sigstore|fulcio|rekor/.test(call.host), JSON.stringify(call));
    }
    return output;
  }
  const before = await snapshot();
  assert.equal(before.status, '');
  save('before', before);
  const preview = run('dry-run', true, true);
  const plan = preview.includes('"schemaVersion": 1') ? parsePlan(preview) : {packages: []};
  if (!plan.head) assert.match(preview, /There are no relevant changes|There are no changes to release/);
  assertIntent(plan, intent, head);
  save('plan', plan);
  assert.deepEqual(await snapshot(), before, 'Dry-run changed source, refs or public inventory');
  run('release', false, intent.expected.length === 0);
  const released = await snapshot(true);
  save('after-release', released);
  assert.equal(released.head, before.head);
  assert.equal(released.status, before.status);
  assert.deepEqual(released.source, before.source, 'Publication must restore tracked source');
  const releasedRefs = new Map(released.refs.map(line => line.split('\t').reverse()));
  for (const line of before.refs) { const [oid, ref] = line.split('\t'); if (!ref.startsWith('refs/notes/')) assert.equal(releasedRefs.get(ref), oid, `Existing ref changed: ${ref}`); }
  const added = [];
  for (const name of names) {
    for (const [version, integrity] of Object.entries(before.inventory[name].versions)) assert.equal(released.inventory[name].versions[version], integrity);
    for (const version of Object.keys(released.inventory[name].versions)) if (!(version in before.inventory[name].versions)) added.push({name, version});
    for (const [tag, version] of Object.entries(before.inventory[name].tags)) if (tag !== intent.channel) assert.equal(released.inventory[name].tags[tag], version);
  }
  assertAddedVersions(added, intent.expected, before.inventory);
  if (!intent.expected.length) assert.deepEqual(released, before, 'Covered backmerge changed release effects');
  let journal;
  if (intent.expected.length) {
    const ref = intent.branch === 'stable7-live' ? 'refs/notes/semantic-release-workspace' : 'refs/notes/workspace-release-branches/' + createHash('sha256').update(intent.branch).digest('hex');
    const entries = git('notes', '--ref=' + ref, 'list').trim().split('\n');
    journal = entries.map(line => JSON.parse(git('cat-file', 'blob', line.split(' ')[0]))).find(value => value.head === head);
    assert.equal(journal?.status, 'complete');
    save('journal', journal);
  }
  for (const expected of intent.expected) {
    const metadata = await registryJson(`https://registry.npmjs.org/${encodeURIComponent(expected.name)}`, {ready: value => !!value.versions?.[expected.version]});
    const release = metadata.versions[expected.version];
    const bytes = Buffer.from(await (await fetch(release.dist.tarball)).arrayBuffer());
    const integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64');
    assert.equal(release.dist.integrity, integrity);
    const record = journal.execution.packages.find(p => p.id === 'npm:' + expected.name);
    assert.ok(record.published && record.tagged);
    assert.equal(record.artifact.integrity, integrity);
    assert.deepEqual(execFileSync('git', ['show', record.artifact.commit + ':artifact']), bytes);
    assert.equal(git('rev-parse', `refs/tags/npm/${expected.name}@${expected.version}`).trim(), journal.execution.prepared);
    const slug = expected.name.split('/').at(-1);
    const tarball = `${directory}/${slug}-${expected.version}.tgz`;
    writeFileSync(tarball, bytes);
    const manifest = JSON.parse(execFileSync('tar', ['-xOf', tarball, 'package/package.json'], {encoding: 'utf8'}));
    assert.equal(manifest.name, expected.name);
    assert.equal(manifest.version, expected.version);
    const planned = plan.packages.find(p => p.name === expected.name);
    for (const dependency of planned.dependencyUpdates) assert.equal(manifest[dependency.field[0]][dependency.field[1]], dependency.publishedRange);
    assert.ok(release.dist.attestations?.url, 'Public npm provenance is required');
    const attestations = await (await fetch(release.dist.attestations.url)).json();
    const statements = attestations.attestations.map(a => a.bundle?.dsseEnvelope?.payload).filter(Boolean).map(payload => JSON.parse(Buffer.from(payload, 'base64').toString('utf8')));
    const sha256 = createHash('sha256').update(bytes).digest('hex'), sha512 = createHash('sha512').update(bytes).digest('hex');
    assert.ok(statements.some(statement => statement.subject?.some(subject => subject.digest?.sha256 === sha256 || subject.digest?.sha512 === sha512) && statement.predicate?.buildDefinition?.resolvedDependencies?.some(dependency => dependency.digest?.gitCommit === head && dependency.uri?.includes('github.com/' + process.env.GITHUB_REPOSITORY))), 'Provenance must bind exact public bytes and push source');
    save(slug + '-metadata', release);
    save(slug + '-attestations', attestations);
    save(slug + '-manifest', manifest);
  }
  if (intent.expected.length) {
    const app = intent.expected.find(p => p.name === names[1]);
    assert.ok(app, 'Each public wave must include the downstream app');
    for (const native of new Set([manager, 'npm'])) {
      const consumer = mkdtempSync(join(tmpdir(), 'srw-live-alpha7-consumer-'));
      try {
        writeFileSync(join(consumer, 'package.json'), JSON.stringify({private: true, type: 'module', packageManager: native === manager ? root.packageManager : 'npm@12.2.1', dependencies: {[app.name]: app.version}}));
        const approved = intent.expected.map(p => `  - ${JSON.stringify(p.name + '@' + p.version)}`).join('\n');
        if (native === 'yarn') writeFileSync(join(consumer, '.yarnrc.yml'), `nodeLinker: pnp\nenableScripts: false\nnpmPreapprovedPackages:\n${approved}\n`);
        if (native === 'pnpm') writeFileSync(join(consumer, 'pnpm-workspace.yaml'), `minimumReleaseAgeExclude:\n${approved}\n`);
        const install = native === 'yarn' ? ['install', '--no-immutable'] : ['install', ...(native === 'pnpm' ? ['--no-frozen-lockfile'] : ['--no-audit', '--no-fund']), '--ignore-scripts', '--registry=https://registry.npmjs.org'];
        execFileSync(native, install, {cwd: consumer, stdio: 'inherit'});
        const execute = ['--input-type=module', '-e', `import {answer} from '${app.name}';console.log(answer())`];
        const output = native === 'yarn' ? execFileSync('yarn', ['exec', 'node', ...execute], {cwd: consumer, encoding: 'utf8'}) : execFileSync('node', execute, {cwd: consumer, encoding: 'utf8'});
        assert.equal(output.trim(), '42');
        save(`native-${native}-consumer`, {manager: native, app, output: output.trim()});
        if (native === 'npm') writeFileSync(`${directory}/native-provenance-verification.txt`, execFileSync('npm', ['audit', 'signatures'], {cwd: consumer, encoding: 'utf8'}));
      } finally { rmSync(consumer, {recursive: true, force: true}); }
    }
  }
  const beforeNoChange = await snapshot();
  save('before-no-change', beforeNoChange);
  run('no-change', false, true);
  const afterNoChange = await snapshot();
  save('after-no-change', afterNoChange);
  assert.deepEqual(afterNoChange, beforeNoChange, 'No-change run changed source, refs or public inventory');
  save('result', {status: 'PASS', mode: intent.mode, phase: intent.phase, event: process.env.GITHUB_EVENT_NAME, branch: intent.branch, head, intent, added, product: 'semantic-release-workspace@1.0.0-alpha.7', node: process.version, npm: '12.2.1', manager, noChangeEffects: 0, temporaryConsumerRemoved: true});
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
