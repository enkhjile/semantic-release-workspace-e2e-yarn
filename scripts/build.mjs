import {mkdirSync,copyFileSync,readdirSync,writeFileSync} from 'node:fs';
for(const role of process.argv[2] ? [process.argv[2]] : readdirSync('packages')){const base=(process.argv[2] ? '.' : 'packages/'+role);mkdirSync(base+'/dist',{recursive:true});copyFileSync(base+'/src/index.js',base+'/dist/index.js');writeFileSync(base+'/dist/build-nonce.txt',String(Date.now())+'-'+Math.random());}
