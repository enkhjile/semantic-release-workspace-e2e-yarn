import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {registryJson} from './registry-read.mjs';
async function server(responses,body){let calls=0;const server=createServer((req,res)=>{const entry=responses[Math.min(calls++,responses.length-1)];res.writeHead(entry.status,{'content-type':'application/json'});res.end(JSON.stringify(entry.value));});server.listen(0,'127.0.0.1');await once(server,'listening');try{await body(`http://127.0.0.1:${server.address().port}`,()=>calls);}finally{server.close();await once(server,'close');}}
test('registry visibility retry waits through404 and stale200 before returning the required version',async()=>{await server([{status:404,value:{}},{status:200,value:{versions:{}}},{status:200,value:{versions:{'1.0.0':{}}}}],async(url,calls)=>{const result=await registryJson(url,{ready:v=>!!v.versions?.['1.0.0'],attempts:3,intervalMs:1});assert.ok(result.versions['1.0.0']);assert.equal(calls(),3);});});
test('registry reads stop at their bound without publication or401 retries',async()=>{await server([{status:404,value:{}}],async(url,calls)=>{await assert.rejects(registryJson(url,{attempts:2,intervalMs:1}),/404/);assert.equal(calls(),2);});await server([{status:401,value:{}}],async(url,calls)=>{await assert.rejects(registryJson(url,{attempts:3,intervalMs:1}),/401/);assert.equal(calls(),1);});});
