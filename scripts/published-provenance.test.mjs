import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {assertPublishedReleaseIntent, hasExpectedProvenance, publishedRelease} from './published-provenance.mjs';

const manager=JSON.parse(readFileSync(new URL('../package.json',import.meta.url))).packageManager.split('@')[0];
const alpha4Sources={npm:'25ccd6cf0bf5630891ab789403332637a85ebfc4',pnpm:'886f17497abfb21224d59a23db2369a89e88a158',yarn:'3235b668114f47ba24f960d6f078444f20419f21'};

test('alpha4 app provenance binds its immutable published source',()=>{
 const release=publishedRelease(manager,'app'),core=publishedRelease(manager,'core'),repository=`enkhjile/semantic-release-workspace-e2e-${manager}`,digest='verified-tarball';
 assert.equal(release.version,'1.1.0-alpha4.1');
 assert.equal(release.source,alpha4Sources[manager]);
 assert.equal(release.tag,`npm/@enkhjile/srw-e2e-${manager}-app@1.1.0-alpha4.1`);
 assert.equal(core.tag,'workspace-v1.0.0-alpha3.1');
 assert.equal(release.requireCheckoutAncestor,true);
 assert.equal(core.requireCheckoutAncestor,false);
 const statement={subject:[{digest:{sha512:digest}}],predicate:{buildDefinition:{resolvedDependencies:[{uri:`git+https://github.com/${repository}@refs/heads/alpha4-live`,digest:{gitCommit:release.source}}]}}};
 assert.ok(hasExpectedProvenance([statement],digest,digest,release.source,repository));
 assert.ok(!hasExpectedProvenance([statement],digest,digest,'later-checkout-head',repository));
});

test('published source must remain in both checkout history and the package release tag',()=>{
 const source='published-source',head='later-checkout-head',tag='npm/package@1.1.0-alpha4.1';
 const contains=new Set([`${source}:${head}`,`${source}:${tag}`]);
 assert.doesNotThrow(()=>assertPublishedReleaseIntent({expectedSource:source,currentHead:head,releaseTag:tag,isAncestor:(ancestor,descendant)=>contains.has(`${ancestor}:${descendant}`)}));
 assert.doesNotThrow(()=>assertPublishedReleaseIntent({expectedSource:source,currentHead:head,releaseTag:tag,requireCheckoutAncestor:false,isAncestor:(ancestor,descendant)=>ancestor===source&&descendant===tag}));
 assert.throws(()=>assertPublishedReleaseIntent({expectedSource:source,currentHead:head,releaseTag:tag,isAncestor:(ancestor,descendant)=>ancestor===source&&descendant===tag}),/checkout history/);
 assert.throws(()=>assertPublishedReleaseIntent({expectedSource:source,currentHead:head,releaseTag:tag,isAncestor:(ancestor,descendant)=>ancestor===source&&descendant===head}),/release tag/);
});
