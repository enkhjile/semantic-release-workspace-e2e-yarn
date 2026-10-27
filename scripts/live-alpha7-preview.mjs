import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const directory = 'evidence/live-alpha7-preview';
mkdirSync(directory, {recursive: true});
assert.equal(process.env.GITHUB_EVENT_NAME, 'push');
assert.ok(['alpha', 'main'].includes(process.env.GITHUB_REF_NAME));
assert.equal(JSON.parse(readFileSync('package.json')).devDependencies['semantic-release-workspace'], '1.0.0-alpha.7');
for (const name of ['NPM_TOKEN', 'NODE_AUTH_TOKEN']) assert.ok(!process.env[name], `${name} must be absent`);
const git = (...args) => execFileSync('git', args, {encoding: 'utf8'});
assert.equal(git('rev-parse', 'HEAD').trim(), process.env.GITHUB_SHA);
async function snapshot() {
  const inventory = {};
  for (const name of ['@enkhjile/srw-e2e-yarn-core', '@enkhjile/srw-e2e-yarn-app']) {
    const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}?srw_live_alpha7=${Date.now()}`, {headers: {'cache-control': 'no-cache'}, signal: AbortSignal.timeout(30000)});
    assert.equal(response.status, 200);
    const metadata = await response.json();
    inventory[name] = {tags: metadata['dist-tags'], versions: Object.fromEntries(Object.entries(metadata.versions).map(([version, entry]) => [version, entry.dist.integrity]))};
  }
  return {
    head: git('rev-parse', 'HEAD').trim(),
    status: git('status', '--porcelain'),
    refs: git('ls-remote', '--refs', 'origin').trim().split('\n').sort(),
    source: git('ls-files', '-z').split('\0').filter(Boolean).map(path => ({path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex')})),
    inventory,
  };
}
const before = await snapshot();
assert.equal(before.status, '', 'The pushed source must be clean');
writeFileSync(`${directory}/before.json`, JSON.stringify(before, null, 2) + '\n');
const audit = resolve(`${directory}/http.jsonl`);
writeFileSync(audit, '');
const child = spawnSync('yarn', ['exec', 'semantic-release', '--dry-run'], {
  encoding: 'utf8', maxBuffer: 16 * 1024 * 1024,
  env: {...process.env, NODE_OPTIONS: [process.env.NODE_OPTIONS, '--import=' + pathToFileURL(resolve('scripts/network-count.mjs')).href].filter(Boolean).join(' '), SRW_HTTP_AUDIT: audit},
});
const output = (child.stdout ?? '') + (child.stderr ?? '');
writeFileSync(`${directory}/dry-run.log`, output);
process.stdout.write(output);
const after = await snapshot();
writeFileSync(`${directory}/after.json`, JSON.stringify(after, null, 2) + '\n');
assert.deepEqual(after, before, 'Dry-run changed source, refs or public inventory');
const calls = readFileSync(audit, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
assert.ok(calls.some(call => call.transport === 'observer'));
for (const call of calls.filter(call => call.transport !== 'observer')) {
  assert.ok(['GET', 'HEAD', 'OPTIONS'].includes(call.method), JSON.stringify(call));
  assert.ok(!/actions\.githubusercontent|token\.actions|sigstore|fulcio|rekor/.test(call.host), JSON.stringify(call));
}
const result = {mode: 'preview-only', event: process.env.GITHUB_EVENT_NAME, branch: process.env.GITHUB_REF_NAME, head: before.head, node: process.version, npm: execFileSync('npm', ['--version'], {encoding: 'utf8'}).trim(), yarn: execFileSync('yarn', ['--version'], {encoding: 'utf8'}).trim(), exitCode: child.status, registryChanges: 0, remoteRefChanges: 0, identityRequests: 0};
writeFileSync(`${directory}/result.json`, JSON.stringify(result, null, 2) + '\n');
assert.equal(child.status, 0, 'Real semantic-release dry-run failed; no publication was attempted');
