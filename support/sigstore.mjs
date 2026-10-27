import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
export async function startSigning(){
 const root=await mkdtemp(join(tmpdir(),'srw-alpha6-signing-'));
 const cwd=fileURLToPath(new URL('..',import.meta.url));
 const manager=JSON.parse(await readFile(join(cwd,'package.json'),'utf8')).packageManager.split('@')[0];
 const server=spawn(manager,[...(manager==='npm'?['exec','--']:['exec']),'node',fileURLToPath(new URL('./sigstore-server.mjs',import.meta.url)),root],{cwd,stdio:['pipe','pipe','inherit']});
 const url=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(new Error('Signer did not start')),15000);server.stdout.on('data',value=>{output+=value;const match=output.match(/SRW_SIGNER_URL=(http:\/\/127\.0\.0\.1:\d+)/);if(match){clearTimeout(timer);resolve(match[1]);}});server.once('error',error=>{clearTimeout(timer);reject(error);});server.once('exit',code=>{clearTimeout(timer);reject(new Error(`Signer exited ${code}`));});});
 return {config:{fulcioURL:url,rekorURL:url,tufMirrorURL:`${url}/tuf`,tufRootPath:join(root,'root.json')},events:async()=>JSON.parse(await readFile(join(root,'events.json'),'utf8')),close:async()=>{try{if(server.exitCode===null){const exited=once(server,'exit');server.stdin.end();await exited;}}finally{await rm(root,{recursive:true,force:true});}}};
}
