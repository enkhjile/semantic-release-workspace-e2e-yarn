import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const workflow=readFileSync(new URL('../.github/workflows/live-release.yml',import.meta.url),'utf8');
test('live workflow verifies the published candidate before one recovery invocation',()=>{const candidate=workflow.indexOf('node scripts/live-proof.mjs candidate'),recovery=workflow.indexOf('yarn exec semantic-release 2>&1 | tee ../evidence/live-fresh-recovery.log');assert.ok(candidate>=0,'missing candidate visibility proof');assert.ok(recovery>candidate,'recovery must follow candidate verification');const section=workflow.slice(candidate,workflow.indexOf('Verify public digests',candidate));assert.doesNotMatch(section,/for attempt|sleep 30|live-fresh-retry-/);});
