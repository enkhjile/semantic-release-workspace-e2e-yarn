import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {answer as coreAnswer} from '../live/core/index.js';
import {answer as appAnswer} from '../live/app/index.js';
import {role} from '../live/private/index.js';
test('real public dependent resolves the workspace core',()=>{assert.equal(coreAnswer(),42);assert.equal(appAnswer(),42);});
test('private discovery fixture is explicitly non-publishable',()=>{const p=JSON.parse(readFileSync('live/private/package.json'));assert.equal(p.private,true);assert.equal(role,'private');});
