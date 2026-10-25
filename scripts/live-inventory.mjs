import assert from 'node:assert/strict';import {readFileSync,readdirSync} from 'node:fs';
const root=JSON.parse(readFileSync('package.json'));assert.deepEqual(root.workspaces,['live/*']);assert.equal(root.private,true);
const packages=readdirSync('live').map(p=>JSON.parse(readFileSync('live/'+p+'/package.json')));assert.equal(packages.length,2);
assert.deepEqual(packages.map(p=>p.name).sort(),["@enkhjile/srw-e2e-yarn-app", "@enkhjile/srw-e2e-yarn-core"]);assert.ok(packages.every(p=>p.private!==true));console.log(JSON.stringify({lane:'DIAGNOSTIC_LIVE_OIDC',packages:packages.map(({name,version})=>({name,version}))}));
