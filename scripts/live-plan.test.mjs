import {test} from 'node:test';import assert from 'node:assert/strict';import {parsePlan} from './live-plan.mjs';
test('prerelease plan nested release metadata precedes schemaVersion',()=>{const expected={release:{branch:'alpha3',type:'prerelease',channel:'alpha3'},schemaVersion:1,packages:[{name:'approved',nextVersion:'1.1.0-alpha3.1'}]};assert.deepEqual(parsePlan('log before\n'+JSON.stringify(expected,null,2)+'\nlog after'),expected);});
test('missing complete workspace plan fails closed',()=>{assert.throws(()=>parsePlan('{"schemaVersion": 1,"other":true}'),/workspace plan/);});
