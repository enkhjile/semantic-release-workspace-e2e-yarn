import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const root=JSON.parse(readFileSync('package.json'));const manager=root.packageManager.split('@')[0];const app=JSON.parse(readFileSync('live/app/package.json'));
assert.deepEqual(root.workspaces,['live/app']);assert.equal(root.private,true);assert.equal(root.devDependencies['semantic-release-workspace'],'1.0.0-alpha.4');assert.equal(app.name,`@enkhjile/srw-e2e-${manager}-app`);assert.equal(app.private,undefined);assert.equal(app.version,'1.0.0');assert.deepEqual(app.dependencies,{[`@enkhjile/srw-e2e-${manager}-core`]:'1.1.0-alpha3.1'});console.log(JSON.stringify({lane:'PUBLISHED_ALPHA4_APP_ONLY',maximumNewVersions:1,app,plugin:root.devDependencies['semantic-release-workspace']}));
