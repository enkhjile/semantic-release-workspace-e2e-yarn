import {allMembersPublished, assertExpectedBoundary, injectRetryBoundary} from './retry-boundary.mjs';
import {assertReadOnlyNetwork, networkSummary} from './network-policy.mjs';
import {assertFrozenRecovery, assertRetainedPublication} from './candidate-helpers.mjs';
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
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

export function resolvePublishPlan(loggedPlan, journal, head) {
  if (loggedPlan) return loggedPlan;
  assert.equal(journal?.status, 'complete', 'No new release is success only when this exact source is already complete');
  assert.equal(journal.head, head);
  return journal.planning.plan;
}

async function main() {
  const intents = JSON.parse(readFileSync('cycle-intent.json'));
  const intent = intents.branches[process.env.GITHUB_REF_NAME];
  assert.ok(intent, 'Missing explicit branch intent');
  const binding = JSON.parse(readFileSync(new URL('../package.json', import.meta.resolve('semantic-release-workspace'))));
  assert.equal(binding.version, '1.0.0-alpha.10');
  const baseline = JSON.parse(readFileSync('cycle-public-baseline.json'));
  const root = JSON.parse(readFileSync('package.json'));
  const manager = root.packageManager?.split('@')[0] ?? 'npm';
  assert.ok(['npm', 'pnpm', 'yarn'].includes(manager));
  assert.equal(root.devDependencies['semantic-release-workspace'], '1.0.0-alpha.10');
  assert.ok(['alpha', 'main'].includes(intent.branch));
  assert.equal(intent.channel, intent.branch === 'main' ? 'latest' : 'alpha');
  const retired = JSON.parse(readFileSync('shared-retired-versions.json'));

  assert.equal(intent.budgetLimit, 12);
  assert.equal(process.env.GITHUB_REPOSITORY, 'enkhjile/semantic-release-workspace-e2e-' + manager);
  assert.equal(process.env.GITHUB_EVENT_NAME, 'push');
  assert.equal(process.env.GITHUB_REF_NAME, intent.branch);
  assert.ok(['preview', 'publish', 'no-change'].includes(intent.mode));
  assert.ok(intent.expected.length <= 2);
  if (intent.mode === 'no-change') assert.equal(intent.expected.length, 0);
  for (const name of ['NPM_TOKEN', 'NODE_AUTH_TOKEN', 'CARGO_REGISTRY_TOKEN', 'CARGO_REGISTRIES_CRATES_IO_TOKEN']) assert.ok(!process.env[name], `${name} must be absent`);
  assert.equal(execFileSync('npm', ['--version'], {encoding: 'utf8'}).trim(), '12.2.1');
  const git = (...args) => execFileSync('git', args, {encoding: 'utf8'});
  const head = git('rev-parse', 'HEAD').trim();
  assert.equal(head, process.env.GITHUB_SHA);
  const directory = 'evidence/alpha10-cycle';
  mkdirSync(directory, {recursive: true});
  const save = (name, value) => writeFileSync(`${directory}/${name}.json`, JSON.stringify(value, null, 2) + '\n');
  const names = ['core', 'app'].map(part => JSON.parse(readFileSync(`live/${part}/package.json`)).name);
  assert.equal(new Set(names).size, 2);
  assert.ok(intent.expected.every(p => names.includes(p.name) && typeof p.version === 'string'));
  async function snapshot(ready = false) {
    const inventory = {};
    for (const name of names) {
      const candidate = intent.expected.find(p => p.name === name);
      const metadata = await registryJson(`https://registry.npmjs.org/${encodeURIComponent(name)}`, {timeoutMs: ready ? 1200000 : 60000, intervalMs: 15000, ready: value => !ready || !candidate || !!value.versions?.[candidate.version] && value['dist-tags']?.[intent.channel] === candidate.version});
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
    assert.ok(output.includes(`Run automated release from branch ${intent.branch}`), 'CLI must select the intended branch');
    const calls = readFileSync(audit, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
    assert.ok(calls.some(call => call.transport === 'observer'));
    if (readonly) {
      // A frozen retry may still create its aggregate GitHub release, but may
      // never repeat registry writes, signing, or OIDC token requests.
      const checked = label === 'release' && allMembersPublished(currentJournal(), intent, head)
        ? calls.filter(call => call.host !== 'api.github.com') : calls;
      assertReadOnlyNetwork(checked);
    }
    save(label + '-http-summary', networkSummary(calls));
    if (child.status !== 0) {
      const pending = currentJournal();
      if (pending) save(label + '-failed-journal', pending);
      save(label + '-failure', {exitCode: child.status, source: head, automaticRetry: false, instruction: 'Inspect frozen artifacts and poll registry read-only. Do not reupload accepted bytes or advance versions.'});
    }
  if (child.status !== 0 && label === 'release' && injectRetryBoundary(intent, process.env.GITHUB_RUN_ATTEMPT)) {
    const pending = currentJournal();
    assertExpectedBoundary({intent, attempt: process.env.GITHUB_RUN_ATTEMPT, output, journal: pending, head});
    assert.equal(git('rev-parse', 'refs/tags/' + pending.batchTag).trim(), head);
    save('expected-pending-retry', {status: 'EXPECTED_FAILURE', source: head, version: intent.version, attempt: process.env.GITHUB_RUN_ATTEMPT, frozen: pending, instruction: 'Confirm exact public registry bytes and ledger, then rerun this same GitHub run with a fresh checkout. Do not edit source or advance versions.'});
  }
    assert.equal(child.status, 0, `${label} real semantic-release failed`);
    return output;
  }
  function currentJournal() {
    const ref = 'refs/notes/workspace-release-branches/' + createHash('sha256').update(intent.branch).digest('hex');
    const result = spawnSync('git', ['notes', '--ref=' + ref, 'list'], {encoding: 'utf8'});
    if (result.status !== 0) return null;
    return result.stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(git('cat-file', 'blob', line.split(' ')[0]))).find(value => value.head === head) ?? null;
  }
  const before = await snapshot();
  assert.equal(before.status, '');
  save('before', before);
  const alreadyAdded = names.reduce((count, name) => {
    assert.ok(baseline[name], 'Missing original public baseline');
    for (const [version, integrity] of Object.entries(baseline[name].versions)) assert.equal(before.inventory[name].versions[version], integrity);
    return count + Object.keys(before.inventory[name].versions).filter(v => !(v in baseline[name].versions)).length;
  }, 0);
  const expectedAdditionalVersions = intent.expected.filter(p => !(p.version in before.inventory[p.name].versions)).length;
  assert.ok(alreadyAdded + expectedAdditionalVersions <= 5, 'Reserved cycle lane budget exceeded');
  for (const expected of intent.expected) {
    assert.match(expected.version, intent.branch === 'alpha' ? /^\d+\.\d+\.\d+-alpha\.\d+$/ : /^\d+\.\d+\.\d+$/);
    const permitted = intent.branch === 'main'
      ? {[names[0]]: ['1.4.0'], [names[1]]: ['2.0.0']}
      : {[names[0]]: ['1.5.0-alpha.1', '1.5.0-alpha.2'], [names[1]]: ['2.0.0-alpha.1']};
    assert.ok(permitted[expected.name]?.includes(expected.version), 'Version outside the exact approved cycle allowlist');
    assert.ok(!(expected.version in (retired.packages[expected.name]?.versions ?? {})), 'Never reuse a retired version');
    assert.ok(!(expected.version in baseline[expected.name].versions), 'Cycle cannot authorize preexisting versions');
  }
  for (const member of intent.unchangedMembers ?? []) {
    const part = member.endsWith('-core') ? 'core' : 'app';
    assert.match(intent.previousSourceSha, /^[a-f0-9]{40}$/);
    assert.equal(git('diff', '--name-only', intent.previousSourceSha, head, '--', 'live/' + part).trim(), '', 'Unchanged member source must match previous merged source');
  }
  const preview = run('dry-run', true, true);
  const frozenBefore = currentJournal();
  const loggedPlan = preview.includes('"schemaVersion": 1') ? parsePlan(preview) : null;
  let plan = loggedPlan;
  if (intent.mode === 'preview') {
    assert.equal(intent.expected.length, 0, 'Setup preview cannot carry upload authorization');
    if (plan) {
      assert.equal(plan.release.branch, intent.branch);
      assert.equal(plan.release.prerelease ?? null, intent.branch === 'alpha' ? 'alpha' : null);
    assert.equal(plan.dependencyPolicy, 'independent');
      save('plan', plan);
    }
    assert.deepEqual(await snapshot(), before, 'Setup preview changed source, refs or public inventory');
    save('result', {status: 'PASS', mode: 'preview', source: head, candidateSha: binding.sha, uploads: 0, identityRequests: 0});
    return;
  }
  if (intent.mode === 'publish') {
    plan = resolvePublishPlan(plan, frozenBefore, head);
    assertIntent(plan, intent, head);
    assert.equal(plan.release.prerelease ?? null, intent.branch === 'alpha' ? 'alpha' : null);
    assert.equal(plan.dependencyPolicy, 'independent');
  } else {
    if (plan) assert.equal(plan.packages.filter(p => !p.private && p.nextVersion).length, 0);
    else assert.match(preview, /There are no relevant changes|There are no changes to release/);
    plan ??= {packages: []};
  }
  save('plan', plan);
  if (frozenBefore) save('journal-before', frozenBefore);
  assert.deepEqual(await snapshot(), before, 'Dry-run changed source, refs or public inventory');
  run('release', false, intent.expected.length === 0 || frozenBefore?.status === 'complete' || allMembersPublished(frozenBefore, intent, head));
  const released = await snapshot(true);
  save('after-release', released);
  assert.equal(released.head, before.head);
  assert.equal(released.status, before.status);
  assert.deepEqual(released.source, before.source, 'Publication must restore tracked source');
  const releasedRefs = new Map(released.refs.map(line => line.split('\t').reverse()));
  const originalRefs = new Map(before.refs.map(line => line.split('\t').reverse()));
  for (const [ref, oid] of releasedRefs) if (ref.startsWith('refs/tags/') && !originalRefs.has(ref)) {
    assert.ok(ref.startsWith('refs/tags/workspace-v') || intent.expected.some(p => ref === 'refs/tags/npm/' + p.name + '@' + p.version), 'Unexpected tag');
  }
  const alphaKey = createHash('sha256').update(intent.branch).digest('hex');
  const mutableNotes = new Set(['refs/notes/workspace-release-branches/' + alphaKey, 'refs/notes/workspace-release-history/' + alphaKey, 'refs/notes/semantic-release-0-workspace']);
  for (const line of before.refs) {
    const [oid, ref] = line.split('\t');
    if (!mutableNotes.has(ref)) assert.equal(releasedRefs.get(ref), oid, `Existing ref changed: ${ref}`);
    else if (releasedRefs.get(ref) !== oid) {
      git('merge-base', '--is-ancestor', oid, releasedRefs.get(ref));
      if (!ref.includes('workspace-release-branches/')) {
        for (const entry of git('ls-tree', '-r', oid).trim().split('\n').filter(Boolean)) {
          const [meta, path] = entry.split('\t');
          assert.equal(git('rev-parse', releasedRefs.get(ref) + ':' + path).trim(), meta.split(' ')[2], 'Historical note entry changed');
        }
      }
    }
  }
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
    journal = currentJournal();
    assert.equal(journal?.status, 'complete', 'Successful CLI return alone does not prove frozen publication completed');
    assert.equal(journal.head, head);
    assert.deepEqual(journal.planning.plan.packages.filter(p => !p.private && p.nextVersion).map(p => ({name:p.name,version:p.nextVersion})).sort((a,b)=>a.name.localeCompare(b.name)), [...intent.expected].sort((a,b)=>a.name.localeCompare(b.name)));
    assert.equal(git('rev-parse', 'refs/tags/' + journal.batchTag).trim(), head);
    if (frozenBefore) assertFrozenRecovery(journal, frozenBefore);
    const changelog = git('show', journal.execution.prepared + ':CHANGELOG.md');
    for (const expected of intent.expected) { assert.ok(changelog.includes(expected.name)); assert.ok(changelog.includes(expected.version)); }
    assert.deepEqual(git('ls-tree', '-r', '--name-only', journal.execution.prepared).trim().split('\n').filter(path => /(^|\/)CHANGELOG\.md$/.test(path)), ['CHANGELOG.md']);
    save('root-changelog', {prepared: journal.execution.prepared, content: changelog});
    const githubResponse = await fetch('https://api.github.com/repos/' + process.env.GITHUB_REPOSITORY + '/releases/tags/' + encodeURIComponent(journal.batchTag), {headers: {authorization: 'Bearer ' + process.env.GITHUB_TOKEN, accept: 'application/vnd.github+json'}});
    assert.equal(githubResponse.status, 200, 'Aggregate GitHub release missing');
    const githubRelease = await githubResponse.json();
    assert.equal(githubRelease.prerelease, intent.branch === 'alpha');
    for (const expected of intent.expected) { assert.ok(githubRelease.body.includes(expected.name)); assert.ok(githubRelease.body.includes(expected.version)); }
    save('aggregate-github-release', {url: githubRelease.html_url, tag: githubRelease.tag_name, prerelease: githubRelease.prerelease, body: githubRelease.body});
    save('journal', journal);
  }
  for (const expected of intent.expected) {
    const metadata = await registryJson(`https://registry.npmjs.org/${encodeURIComponent(expected.name)}`, {ready: value => !!value.versions?.[expected.version]});
    const release = metadata.versions[expected.version];
    const bytes = Buffer.from(await (await fetch(release.dist.tarball)).arrayBuffer());
    const integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64');
    assert.equal(release.dist.integrity, integrity);
    const record = journal.execution.packages.find(p => p.id === 'npm:' + expected.name);
    assertRetainedPublication(record, journal, releasedRefs);
    assert.equal(git('rev-parse', record.artifact.commit + '^').trim(), journal.execution.prepared);
    assert.equal(git('rev-parse', journal.execution.prepared + '^').trim(), head);
    assert.equal(record.artifact.integrity, integrity);
    assert.deepEqual(execFileSync('git', ['show', record.artifact.commit + ':artifact']), bytes);
    const slug = expected.name.split('/').at(-1);
    const tarball = `${directory}/${slug}-${expected.version}.tgz`;
    writeFileSync(tarball, bytes);
    const manifest = JSON.parse(execFileSync('tar', ['-xOf', tarball, 'package/package.json'], {encoding: 'utf8'}));
    assert.equal(manifest.name, expected.name);
    assert.equal(manifest.version, expected.version);
    const planned = plan.packages.find(p => p.name === expected.name);
    for (const dependency of planned.dependencyUpdates ?? []) assert.equal(manifest[dependency.field[0]][dependency.field[1]], dependency.publishedRange);
    if (expected.name === names[1]) {
      assert.equal(manifest.dependencies[names[0]], JSON.parse(readFileSync('live/app/package.json')).dependencies[names[0]], 'Explicit app pin changed');
    }
    assert.equal(release._npmUser?.trustedPublisher?.id, 'github');
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
    const target = app ?? intent.expected[0];
    for (const native of new Set([manager, 'npm'])) {
      const consumer = mkdtempSync(join(tmpdir(), 'srw-shared-alpha-consumer-'));
      try {
        writeFileSync(join(consumer, 'package.json'), JSON.stringify({private: true, type: 'module', packageManager: native === manager ? root.packageManager : 'npm@12.2.1', dependencies: Object.fromEntries(intent.expected.map(p => [p.name, p.version]))}));
        const approvedEntries = intent.expected.map(p => p.name + '@' + p.version);
        if (app) {
          const corePin = JSON.parse(readFileSync('live/app/package.json')).dependencies[names[0]];
          assert.match(corePin, /^\d+\.\d+\.\d+(?:-alpha\.\d+)?$/);
          approvedEntries.push(names[0] + '@' + corePin);
        }
        const approved = [...new Set(approvedEntries)].map(entry => `  - ${JSON.stringify(entry)}`).join('\n');
        if (native === 'yarn') writeFileSync(join(consumer, '.yarnrc.yml'), `nodeLinker: pnp\nenableScripts: false\nnpmPreapprovedPackages:\n${approved}\n`);
        if (native === 'pnpm') writeFileSync(join(consumer, 'pnpm-workspace.yaml'), `minimumReleaseAgeExclude:\n${approved}\n`);
        const install = native === 'yarn' ? ['install', '--no-immutable'] : ['install', ...(native === 'pnpm' ? ['--no-frozen-lockfile'] : ['--no-audit', '--no-fund']), '--ignore-scripts', '--registry=https://registry.npmjs.org'];
        execFileSync(native, install, {cwd: consumer, stdio: 'inherit'});
        const execute = ['--input-type=module', '-e', `import {answer} from '${target.name}';console.log(answer())`];
        const output = native === 'yarn' ? execFileSync('yarn', ['exec', 'node', ...execute], {cwd: consumer, encoding: 'utf8'}) : execFileSync('node', execute, {cwd: consumer, encoding: 'utf8'});
        assert.equal(output.trim(), '42');
        let resolution = null;
        if (app) {
          const expectedPin = JSON.parse(readFileSync('live/app/package.json')).dependencies[names[0]];
          const inspect = `import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';const appEntry=import.meta.resolve(${JSON.stringify(names[1])});const api=await import(appEntry);assert.equal(Object.hasOwn(api,'diagnosticLane'),false);const coreEntry=createRequire(appEntry).resolve(${JSON.stringify(names[0])});const appManifest=JSON.parse(readFileSync(new URL('../package.json',appEntry)));const coreManifest=JSON.parse(readFileSync(new URL('../package.json',pathToFileURL(coreEntry))));assert.equal(appManifest.version,${JSON.stringify(app.version)});assert.equal(appManifest.dependencies[${JSON.stringify(names[0])}],${JSON.stringify(expectedPin)});assert.equal(coreManifest.version,${JSON.stringify(expectedPin)});console.log(JSON.stringify({app:appManifest.version,core:coreManifest.version,pin:appManifest.dependencies[${JSON.stringify(names[0])}],removedExport:'diagnosticLane'}));`;
          const inspectArgs = ['--input-type=module', '-e', inspect];
          resolution = JSON.parse(native === 'yarn' ? execFileSync('yarn', ['exec', 'node', ...inspectArgs], {cwd: consumer, encoding: 'utf8'}) : execFileSync('node', inspectArgs, {cwd: consumer, encoding: 'utf8'}));
        }
        save(`native-${native}-consumer`, {manager: native, target, output: output.trim(), resolution});
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
  save('result', {status: 'PASS', mode: intent.mode, phase: intent.phase, event: process.env.GITHUB_EVENT_NAME, branch: intent.branch, head, intent, added, product: {name: 'semantic-release-workspace', version: binding.version}, node: process.version, npm: '12.2.1', manager, noChangeEffects: 0, temporaryConsumerRemoved: true});
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
