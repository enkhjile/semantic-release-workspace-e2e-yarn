import {test} from 'node:test';import assert from 'node:assert/strict';import {answer} from '../packages/core/src/index.js';test('ordinary exported code executes',()=>assert.equal(answer(),42));
