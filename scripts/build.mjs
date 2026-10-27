import {execFileSync} from 'node:child_process';
import {mkdirSync,copyFileSync,readdirSync,writeFileSync,appendFileSync} from 'node:fs';
for(const role of process.argv[2] ? [process.argv[2]] : readdirSync('packages')){const base=(process.argv[2] ? '.' : 'packages/'+role);mkdirSync(base+'/dist',{recursive:true});copyFileSync(base+'/src/index.js',base+'/dist/index.js');writeFileSync(base+'/dist/build-nonce.txt',JSON.stringify({nonce:String(Date.now())+'-'+Math.random(),npmUserAgent:process.env.npm_config_user_agent,npmExecPath:process.env.npm_execpath,npmVersion:process.env.npm_execpath?execFileSync(process.env.npm_execpath,['--version'],{encoding:'utf8'}).trim():null}));}

if(process.env.ACCEPTANCE_BUILD_EVENTS)appendFileSync(process.env.ACCEPTANCE_BUILD_EVENTS,JSON.stringify({cwd:process.cwd(),at:Date.now(),role:process.argv[2]??null})+'\n');
