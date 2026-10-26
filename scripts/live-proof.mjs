import {registryJson} from './registry-read.mjs';
import {assertPublishedReleaseIntent,hasExpectedProvenance,publishedRelease} from './published-provenance.mjs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
const root=JSON.parse(readFileSync('package.json')),manager=root.packageManager.split('@')[0],mode=process.argv[2];
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
const head=git('rev-parse','HEAD');if(process.env.GITHUB_ACTIONS==='true')assert.equal(process.env.GITHUB_SHA,head);const repository=`enkhjile/semantic-release-workspace-e2e-${manager}`;if(process.env.GITHUB_REPOSITORY)assert.equal(process.env.GITHUB_REPOSITORY,repository);
const inventory={};
for(const role of mode==='candidate'?['app']:['core','app']){
 const name=`@enkhjile/srw-e2e-${manager}-${role}`,{version,ref,source:expectedSHA,tag:releaseTag,requireCheckoutAncestor}=publishedRelease(manager,role);
 const metadata=await registryJson('https://registry.npmjs.org/'+encodeURIComponent(name),{...(mode==='candidate'?{candidate:{version,validate:entry=>{assert.equal(entry.name,name,'visible package name mismatch');assert.equal(entry.version,version,'visible package version mismatch');assert.ok(entry.dist?.tarball,'visible candidate is missing a tarball');}},timeoutMs:600000,intervalMs:5000}:{ready:m=>mode==='baseline'||!!m.versions?.[version]}),onAttempt:record=>console.log(JSON.stringify({registryRead:record}))});inventory[name]={versions:Object.keys(metadata.versions).sort(),tags:metadata['dist-tags']};
 if(mode==='baseline'&&role==='app'&&!metadata.versions?.[version])continue;
 const release=metadata.versions[version];assert.ok(release,'approved version absent');const tar=Buffer.from(await(await fetch(release.dist.tarball)).arrayBuffer());assert.equal(release.dist.integrity,'sha512-'+createHash('sha512').update(tar).digest('base64'));writeFileSync('evidence/'+name.split('/')[1]+'.tgz',tar);
 assert.ok(release.dist.attestations?.url,'missing npm provenance');const attestations=await(await fetch(release.dist.attestations.url)).json();writeFileSync('evidence/'+name.split('/')[1]+'.attestations.json',JSON.stringify(attestations,null,2));
 const certs=attestations.attestations.flatMap(a=>a.bundle?.verificationMaterial?.x509CertificateChain?.certificates??(a.bundle?.verificationMaterial?.certificate?[a.bundle.verificationMaterial.certificate]:[]));const texts=certs.map(c=>execFileSync('openssl',['x509','-inform','DER','-noout','-text'],{input:Buffer.from(c.rawBytes,'base64'),encoding:'utf8'}));assert.ok(texts.some(t=>t.includes('https://token.actions.githubusercontent.com')&&t.includes(`https://github.com/${repository}/.github/workflows/live-release.yml@refs/heads/${ref}`)),'certificate issuer/workflow/ref mismatch');writeFileSync('evidence/'+name.split('/')[1]+'.certificates.txt',texts.join('\n'));
 const statements=attestations.attestations.map(a=>a.bundle?.dsseEnvelope?.payload).filter(Boolean).map(p=>JSON.parse(Buffer.from(p,'base64').toString('utf8')));const sha256=createHash('sha256').update(tar).digest('hex'),sha512=createHash('sha512').update(tar).digest('hex');
 const isAncestor=(ancestor,descendant)=>{try{git('merge-base','--is-ancestor',ancestor,descendant);return true;}catch{return false;}};
 assertPublishedReleaseIntent({expectedSource:expectedSHA,currentHead:head,releaseTag,requireCheckoutAncestor,isAncestor});
 assert.ok(hasExpectedProvenance(statements,sha256,sha512,expectedSHA,repository),'source or digest provenance mismatch');
 writeFileSync('evidence/'+name.split('/')[1]+'.statements.json',JSON.stringify({expectedSHA,releaseTag,repository,ref,version,sha256,sha512,statements},null,2));writeFileSync('evidence/'+name.split('/')[1]+'.metadata.json',JSON.stringify(release,null,2));
}
writeFileSync('evidence/live-'+mode+'-inventory.json',JSON.stringify(inventory,null,2));
if(mode==='released'){
 const name=`@enkhjile/srw-e2e-${manager}-app`,consumer=mkdtempSync(join(tmpdir(),'srw-alpha4-native-consumer-'));writeFileSync(join(consumer,'package.json'),JSON.stringify({private:true,type:'module',packageManager:root.packageManager}));
 if(manager==='yarn')writeFileSync(join(consumer,'.yarnrc.yml'),'nodeLinker: pnp\nnpmPreapprovedPackages:\n  - '+JSON.stringify(name+'@1.1.0-alpha4.1')+'\n  - '+JSON.stringify(`@enkhjile/srw-e2e-${manager}-core@1.1.0-alpha3.1`)+'\n');
 const command=manager==='npm'?'npm':manager==='pnpm'?'pnpm':'yarn',args=manager==='npm'?['install','--no-audit','--no-fund',name+'@1.1.0-alpha4.1']:['add',name+'@1.1.0-alpha4.1'];execFileSync(command,args,{cwd:consumer,stdio:'inherit'});
 const script=`import {answer} from '${name}';console.log(answer())`;const answer=execFileSync(manager==='yarn'?'yarn':'node',manager==='yarn'?['node','--input-type=module','-e',script]:['--input-type=module','-e',script],{cwd:consumer,encoding:'utf8'}).trim();assert.equal(answer,'42');
 const audit=mkdtempSync(join(tmpdir(),'srw-alpha4-npm-crypto-'));writeFileSync(join(audit,'package.json'),JSON.stringify({private:true,type:'module'}));execFileSync('npm',['install','--no-audit','--no-fund',name+'@1.1.0-alpha4.1'],{cwd:audit,stdio:'inherit'});writeFileSync('evidence/live-native-provenance-verification.txt',execFileSync('npm',['audit','signatures'],{cwd:audit,encoding:'utf8'}));
 writeFileSync('evidence/native-downstream.json',JSON.stringify({manager,version:root.packageManager,answer,app:name,versionConsumed:'1.1.0-alpha4.1',coreVersion:'1.1.0-alpha3.1'},null,2));
}
console.log(JSON.stringify({lane:'PUBLISHED_ALPHA4_APP_ONLY',mode,source:head,inventory}));
