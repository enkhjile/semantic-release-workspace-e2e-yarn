import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {assertReadOnlyNetwork,networkSummary} from './network-policy.mjs';
import {registryJson} from './registry-read.mjs';
const intent=JSON.parse(readFileSync('cycle-intent.json')).branches[process.env.GITHUB_REF_NAME];
if (intent?.auditStable) await audit(intent.auditStable);
async function audit(target) {
  assert.equal(process.env.GITHUB_REF_NAME,'main');
  assert.equal(intent.mode,'no-change');
  assert.deepEqual(intent.expected,[]);
  assert.match(target.source,/^[a-f0-9]{40}$/);
  const root=JSON.parse(readFileSync('package.json'));
  const manager=root.packageManager.split('@')[0];
  assert.equal(process.env.GITHUB_REPOSITORY,'enkhjile/semantic-release-workspace-e2e-'+manager);
  assert.equal(root.devDependencies['semantic-release-workspace'],'1.0.0-alpha.10');
  const names=['core','app'].map(part=>JSON.parse(readFileSync(`live/${part}/package.json`)).name);
  const expected=[{name:names[0],version:'1.4.0'},{name:names[1],version:'2.0.0'}];
  const pin=JSON.parse(readFileSync('live/app/package.json')).dependencies[names[0]];
  assert.equal(pin,'1.4.0-alpha.2');
  const directory='evidence/alpha10-cycle/stable-audit';mkdirSync(directory,{recursive:true});
  const save=(name,value)=>writeFileSync(`${directory}/${name}.json`,JSON.stringify(value,null,2)+'\n');
  const auditFile=resolve(`${directory}/http.jsonl`);writeFileSync(auditFile,'');process.env.SRW_HTTP_AUDIT=auditFile;
  await import('./network-count.mjs');
  const childEnv={...process.env,NODE_OPTIONS:[process.env.NODE_OPTIONS,'--import='+pathToFileURL(resolve('scripts/network-count.mjs')).href].filter(Boolean).join(' ')};
  const git=(...args)=>execFileSync('git',args,{encoding:'utf8'});
  const refs=()=>git('ls-remote','--refs','origin').trim().split('\n').sort();
  async function inventory(){const result={};for(const name of names){const m=await registryJson('https://registry.npmjs.org/'+encodeURIComponent(name));result[name]={tags:m['dist-tags'],versions:Object.fromEntries(Object.entries(m.versions).map(([version,value])=>[version,value.dist.integrity]))};}return result;}
  const before={head:git('rev-parse','HEAD').trim(),status:git('status','--porcelain'),refs:refs(),inventory:await inventory()};assert.equal(before.status,'');save('before',before);
  git('fetch','origin','refs/notes/*:refs/notes/*','refs/semantic-release-workspace/*:refs/semantic-release-workspace/*');
  const journal=git('notes','--ref=refs/notes/semantic-release-workspace','list').trim().split('\n').filter(Boolean).map(line=>JSON.parse(git('cat-file','blob',line.split(' ')[0]))).find(value=>value.head===target.source);
  assert.equal(journal?.status,'complete');
  const sorted=values=>[...values].sort((a,b)=>a.name.localeCompare(b.name));
  assert.deepEqual(sorted(journal.planning.plan.packages.filter(p=>!p.private&&p.nextVersion).map(p=>({name:p.name,version:p.nextVersion}))),sorted(expected));
  const parents=git('rev-list','--parents','-n','1',target.source).trim().split(' ');assert.deepEqual(parents.slice(1),target.parents);assert.equal(parents.length,3);
  assert.equal(git('rev-parse','refs/tags/'+journal.batchTag).trim(),target.source);
  assert.equal(git('rev-parse',journal.execution.prepared+'^').trim(),target.source);
  const remoteRefs=new Map(before.refs.map(line=>line.split('\t').reverse()));
  const changelog=git('show',journal.execution.prepared+':CHANGELOG.md');
  assert.deepEqual(git('ls-tree','-r','--name-only',journal.execution.prepared).trim().split('\n').filter(path=>/(^|\/)CHANGELOG\.md$/.test(path)),['CHANGELOG.md']);
  const headings=changelog.split('\n').filter(line=>line.startsWith('## npm:'));
  for(const p of expected)assert.ok(headings.some(heading=>heading.startsWith('## npm:'+p.name+'@'+p.version+' ')));
  save('root-changelog',{prepared:journal.execution.prepared,content:changelog,headings});
  const ghResponse=await fetch('https://api.github.com/repos/'+process.env.GITHUB_REPOSITORY+'/releases/tags/'+encodeURIComponent(journal.batchTag),{headers:{authorization:'Bearer '+process.env.GITHUB_TOKEN,accept:'application/vnd.github+json'}});assert.equal(ghResponse.status,200);const release=await ghResponse.json();assert.equal(release.prerelease,false);assert.deepEqual([...release.body.matchAll(/^## npm:([^\n]+)/gm)].map(match=>match[1]).sort(),expected.map(p=>p.name+'@'+p.version).sort());save('github-release',{url:release.html_url,tag:release.tag_name,prerelease:release.prerelease,body:release.body});
  for(const p of expected){
    const metadata=await registryJson('https://registry.npmjs.org/'+encodeURIComponent(p.name)+'/'+p.version);
    const bytes=Buffer.from(await(await fetch(metadata.dist.tarball)).arrayBuffer());
    const integrity='sha512-'+createHash('sha512').update(bytes).digest('base64');
    const record=journal.execution.packages.find(value=>value.id==='npm:'+p.name);
    assert.equal(record.published,true);assert.equal(record.intent,true);assert.equal(record.tagged,true);
    assert.equal(integrity,metadata.dist.integrity);assert.equal(integrity,record.artifact.integrity);
    assert.equal(remoteRefs.get(record.artifact.ref),record.artifact.commit);
    assert.equal(remoteRefs.get('refs/tags/npm/'+p.name+'@'+p.version),journal.execution.prepared);
    assert.equal(git('rev-parse',record.artifact.commit+'^').trim(),journal.execution.prepared);
    assert.deepEqual(execFileSync('git',['show',record.artifact.commit+':artifact']),bytes);
    const manifest=JSON.parse(execFileSync('tar',['-xzOf','-','package/package.json'],{input:bytes,encoding:'utf8'}));assert.equal(manifest.name,p.name);assert.equal(manifest.version,p.version);if(p.name===names[1])assert.equal(manifest.dependencies[names[0]],pin);
    assert.equal(metadata._npmUser?.trustedPublisher?.id,'github');assert.ok(metadata.dist.attestations?.url);
    const attestations=await(await fetch(metadata.dist.attestations.url)).json();const statements=attestations.attestations.map(value=>value.bundle?.dsseEnvelope?.payload).filter(Boolean).map(value=>JSON.parse(Buffer.from(value,'base64').toString('utf8')));
    const sha256=createHash('sha256').update(bytes).digest('hex'),sha512=createHash('sha512').update(bytes).digest('hex');
    assert.ok(statements.some(statement=>statement.subject?.some(subject=>subject.digest?.sha256===sha256||subject.digest?.sha512===sha512)&&statement.predicate?.buildDefinition?.resolvedDependencies?.some(dep=>dep.digest?.gitCommit===target.source&&dep.uri?.includes('github.com/'+process.env.GITHUB_REPOSITORY))));
    const slug=p.name.split('/').at(-1);save(slug+'-metadata',metadata);save(slug+'-manifest',manifest);save(slug+'-attestations',attestations);
  }
  for(const native of new Set([manager,'npm'])){
    const consumer=mkdtempSync(join(tmpdir(),'srw-cycle-stable-audit-'));
    try{
      writeFileSync(join(consumer,'package.json'),JSON.stringify({private:true,type:'module',packageManager:native===manager?root.packageManager:'npm@12.2.1',dependencies:Object.fromEntries(expected.map(p=>[p.name,p.version]))}));
      const allowed=[...expected.map(p=>p.name+'@'+p.version),names[0]+'@'+pin].map(value=>'  - '+JSON.stringify(value)).join('\n');
      if(native==='pnpm')writeFileSync(join(consumer,'pnpm-workspace.yaml'),'minimumReleaseAgeExclude:\n'+allowed+'\n');
      if(native==='yarn')writeFileSync(join(consumer,'.yarnrc.yml'),'nodeLinker: pnp\nenableScripts: false\nnpmPreapprovedPackages:\n'+allowed+'\n');
      const install=native==='yarn'?['install','--no-immutable']:['install',...(native==='pnpm'?['--no-frozen-lockfile']:['--no-audit','--no-fund']),'--ignore-scripts','--registry=https://registry.npmjs.org'];execFileSync(native,install,{cwd:consumer,env:childEnv,stdio:'inherit'});
      const code=`import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';import {pathToFileURL} from 'node:url';const appEntry=import.meta.resolve(${JSON.stringify(names[1])});const api=await import(appEntry);assert.equal(api.answer(),42);assert.equal(Object.hasOwn(api,'diagnosticLane'),false);const coreEntry=createRequire(appEntry).resolve(${JSON.stringify(names[0])});const app=JSON.parse(readFileSync(new URL('../package.json',appEntry)));const core=JSON.parse(readFileSync(new URL('../package.json',pathToFileURL(coreEntry))));const direct=JSON.parse(readFileSync(new URL('../package.json',import.meta.resolve(${JSON.stringify(names[0])}))));assert.equal(app.version,'2.0.0');assert.equal(core.version,${JSON.stringify(pin)});assert.equal(app.dependencies[${JSON.stringify(names[0])}],${JSON.stringify(pin)});assert.equal(direct.version,'1.4.0');console.log(JSON.stringify({app:app.version,transitiveCore:core.version,directCore:direct.version,pin:app.dependencies[${JSON.stringify(names[0])}]}));`;
      const args=['--input-type=module','-e',code];const output=native==='yarn'?execFileSync('yarn',['exec','node',...args],{cwd:consumer,env:childEnv,encoding:'utf8'}):execFileSync('node',args,{cwd:consumer,env:childEnv,encoding:'utf8'});save('native-'+native,JSON.parse(output));
      if(native==='npm')writeFileSync(directory+'/signatures.txt',execFileSync('npm',['audit','signatures'],{cwd:consumer,env:childEnv,encoding:'utf8'}));
    }finally{rmSync(consumer,{recursive:true,force:true});}
  }
  const baseline=JSON.parse(readFileSync('cycle-public-baseline.json'));
  for(const name of names){for(const [version,integrity]of Object.entries(baseline[name].versions))assert.equal(before.inventory[name].versions[version],integrity);for(const [tag,version]of Object.entries(baseline[name].tags))if(!['alpha','latest'].includes(tag))assert.equal(before.inventory[name].tags[tag],version);}
  assert.equal(before.inventory[names[0]].tags.latest,'1.4.0');assert.equal(before.inventory[names[1]].tags.latest,'2.0.0');assert.equal(before.inventory[names[0]].tags.alpha,'1.4.0-alpha.3');assert.equal(before.inventory[names[1]].tags.alpha,'2.0.0-alpha.1');
  const after={head:git('rev-parse','HEAD').trim(),status:git('status','--porcelain'),refs:refs(),inventory:await inventory()};assert.deepEqual(after,before,'Read-only stable audit changed source/refs/inventory');save('after',after);
  const calls=readFileSync(auditFile,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);assertReadOnlyNetwork(calls);save('http-summary',networkSummary(calls));save('journal',journal);save('result',{status:'PASS',source:target.source,parents:target.parents,currentVerificationSource:before.head,expected,publicWrites:0,identityRequests:0,sourceRestored:true,branch:'main',channel:'latest',qualification:'Original stable publication completed; this audit repairs a verifier that incorrectly looked in the alpha-style journal namespace.'});
}
