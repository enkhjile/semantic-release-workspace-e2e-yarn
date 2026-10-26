import assert from 'node:assert/strict';

const releases=Object.freeze({
 npm:Object.freeze({core:Object.freeze({version:'1.1.0-alpha3.1',ref:'alpha3',source:'9067c991d1018e71b1a5ceeac26136180525ceac',tag:'workspace-v1.0.0-alpha3.1',requireCheckoutAncestor:false}),app:Object.freeze({version:'1.1.0-alpha4.1',ref:'alpha4-live',source:'25ccd6cf0bf5630891ab789403332637a85ebfc4',tag:'npm/@enkhjile/srw-e2e-npm-app@1.1.0-alpha4.1',requireCheckoutAncestor:true})}),
 pnpm:Object.freeze({core:Object.freeze({version:'1.1.0-alpha3.1',ref:'alpha3',source:'97e094d37a6d063213c1a45f6e22ecb6647352ce',tag:'workspace-v1.0.0-alpha3.1',requireCheckoutAncestor:false}),app:Object.freeze({version:'1.1.0-alpha4.1',ref:'alpha4-live',source:'886f17497abfb21224d59a23db2369a89e88a158',tag:'npm/@enkhjile/srw-e2e-pnpm-app@1.1.0-alpha4.1',requireCheckoutAncestor:true})}),
 yarn:Object.freeze({core:Object.freeze({version:'1.1.0-alpha3.1',ref:'alpha3',source:'9c4d96da052d7a52403b2b0f2c36ebb547f9a9f6',tag:'workspace-v1.0.0-alpha3.1',requireCheckoutAncestor:false}),app:Object.freeze({version:'1.1.0-alpha4.1',ref:'alpha4-live',source:'3235b668114f47ba24f960d6f078444f20419f21',tag:'npm/@enkhjile/srw-e2e-yarn-app@1.1.0-alpha4.1',requireCheckoutAncestor:true})})
});

export function publishedRelease(manager,role){
 const release=releases[manager]?.[role];
 assert.ok(release,`no immutable published-release record for ${manager}/${role}`);
 return release;
}

export function hasExpectedProvenance(statements,sha256,sha512,expectedSource,repository){
 return statements.some(statement=>statement.subject?.some(subject=>subject.digest?.sha256===sha256||subject.digest?.sha512===sha512)&&statement.predicate?.buildDefinition?.resolvedDependencies?.some(dependency=>dependency.digest?.gitCommit===expectedSource&&dependency.uri?.includes('github.com/'+repository)));
}

export function assertPublishedReleaseIntent({expectedSource,currentHead,releaseTag,requireCheckoutAncestor=true,isAncestor}){
 if(requireCheckoutAncestor)assert.ok(isAncestor(expectedSource,currentHead),`published source is not in checkout history: ${expectedSource}`);
 assert.ok(isAncestor(expectedSource,releaseTag),`published source is not in package release tag history: ${releaseTag}`);
}
