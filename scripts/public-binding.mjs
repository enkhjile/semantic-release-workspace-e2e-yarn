import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {dirname,resolve,join} from 'node:path';
assert.ok(process.env.ACCEPTANCE_NPM_PATH,'explicit native npm directory required');process.env.PATH=process.env.ACCEPTANCE_NPM_PATH+':'+process.env.PATH;
const require=createRequire(import.meta.url);
const directory=resolve('evidence/public-alpha7');mkdirSync(directory,{recursive:true});
const expected='sha512-rpprV1qA3rhteNbewWrLHDZZNBddKKSVhb8nyl4asdw0AVdtMxeZQY2ulXYeA74A87ogIJIrP51MvPJ7QAv9oQ==';
const packedResult=JSON.parse(execFileSync('npm',['pack','semantic-release-workspace@1.0.0-alpha.7','--ignore-scripts','--json','--registry=https://registry.npmjs.org','--pack-destination',directory],{encoding:'utf8'}));const packed=Array.isArray(packedResult)?packedResult[0]:Object.values(packedResult)[0];
assert.equal(packed.integrity,expected);const tarball=join(directory,packed.filename),bytes=readFileSync(tarball);assert.equal('sha512-'+createHash('sha512').update(bytes).digest('base64'),expected);
const files=execFileSync('tar',['-tzf',tarball],{encoding:'utf8'}).trim().split('\n').filter(p=>!p.endsWith('/')).sort();assert.equal(files.length,5);
const packageRoot=resolve(dirname(require.resolve('semantic-release-workspace')),'..');const proof={artifact:'semantic-release-workspace@1.0.0-alpha.7',productSource:'ec8940cb3313363619744b739a996f6486a8ef38',integrity:expected,node:process.version,nodeExecutable:process.execPath,nativeNpm:execFileSync('npm',['--version'],{encoding:'utf8'}).trim(),packageRoot,files:[]};
assert.equal(proof.nativeNpm,'12.2.1');
for(const file of files){const relative=file.replace(/^package\//,'');const publicBytes=execFileSync('tar',['-xOf',tarball,file]);const installedBytes=readFileSync(join(packageRoot,relative));assert.deepEqual(installedBytes,publicBytes,relative+' differs from exact public archive');proof.files.push({path:relative,bytes:publicBytes.length,sha256:createHash('sha256').update(publicBytes).digest('hex')});}
writeFileSync(join(directory,'binding.json'),JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify({artifact:proof.artifact,files:proof.files.length,nativeNpm:proof.nativeNpm,node:proof.node}));
