import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {answer as coreAnswer} from '../live/core/index.js';
import {answer as appAnswer} from '../live/app/index.js';
import {role} from '../live/private/index.js';
test('real public dependent resolves the workspace core',()=>{assert.equal(coreAnswer(),42);assert.equal(appAnswer(),42);});
test('private discovery fixture is explicitly non-publishable',()=>{const p=JSON.parse(readFileSync('live/private/package.json'));assert.equal(p.private,true);assert.equal(role,'private');});

import * as appExports from '../live/app/index.js';
test('app removes the legacy diagnostic lane API',()=>{assert.equal('diagnosticLane' in appExports,false);assert.equal(appExports.answer(),42);});

import {formatAnswer} from '../live/core/index.js';
test('core formats an answer with an explicit unit',()=>assert.equal(formatAnswer('units'),'42 units'));
test('core formats an answer without a unit',()=>assert.equal(formatAnswer(),'42'));
