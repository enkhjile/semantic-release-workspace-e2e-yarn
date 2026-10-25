import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const require=createRequire(import.meta.url);
try{
  const registry='https://registry.npmjs.org/';
  const globalRoot=execFileSync('npm',['root','-g'],{encoding:'utf8'}).trim();
  const npmFetch=require(join(globalRoot,'npm/node_modules/npm-registry-fetch'));
  const npa=require(join(globalRoot,'npm/node_modules/npm-package-arg'));
  const manager=process.env.CONTROL_MANAGER;
  if(!['npm','pnpm','yarn'].includes(manager))throw new Error('invalid manager');
  const names=['core','app'].map(role=>`@enkhjile/srw-e2e-${manager}-${role}`);
  const output={diagnostic:'EXCHANGE_ONLY_NO_UPLOAD',node:process.version,npm:execFileSync('npm',['--version'],{encoding:'utf8'}).trim(),sourceSHA:process.env.GITHUB_SHA,repository:process.env.GITHUB_REPOSITORY,cases:[]};
  for(const name of names)for(const includeNpmCommand of [false,true]){
    const identityURL=new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);identityURL.searchParams.append('audience','npm:registry.npmjs.org');
    const identityResponse=await fetch(identityURL,{headers:{authorization:`Bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}`,accept:'application/json'},redirect:'error'});
    if(!identityResponse.ok)throw new Error('identity request failed');
    const identity=(await identityResponse.json()).value;
    if(typeof identity!=='string')throw new Error('missing identity');
    const claims=JSON.parse(Buffer.from(identity.split('.')[1],'base64url').toString('utf8'));
    const safeClaims=Object.fromEntries(['aud','iss','repository','ref','environment','workflow_ref','job_workflow_ref','sha','repository_visibility'].filter(key=>claims[key]!==undefined).map(key=>[key,claims[key]]));
    const endpoint=new URL(`/-/npm/v1/oidc/token/exchange/package/${npa(name).escapedName}`,registry);
    const result={name,includeNpmCommand,identityClaims:safeClaims};
    try{
      const response=await npmFetch(endpoint,{method:'POST',forceAuth:{token:identity},retry:{retries:0},redirect:'error',...(includeNpmCommand?{npmCommand:'publish'}:{})});
      result.status=response.status;
      const data=await response.json();
      result.responseKeys=Object.keys(data).sort();
      result.responseTypes=Object.fromEntries(Object.entries(data).map(([key,value])=>[key,Array.isArray(value)?'array':value===null?'null':typeof value]));
      result.tokenPresent=typeof data.token==='string'&&!!data.token;
      result.tokenType=['oidc','Bearer','bearer','access_token'].includes(data.token_type)?data.token_type:typeof data.token_type;
      result.expiryIsString=typeof data.expires==='string';
      result.expiryIsDate=Number.isFinite(Date.parse(data.expires));
      result.expiryBeyond15Seconds=typeof data.expires==='string'&&Number.isFinite(Date.parse(data.expires))&&Date.parse(data.expires)>Date.now()+15000;
      result.alpha2ResponseValidation=result.tokenPresent&&data.token_type==='oidc'&&result.expiryBeyond15Seconds;
    }catch(error){result.status=error.statusCode??error.status??null;result.errorCode=typeof error.code==='string'&&/^[A-Z0-9_]{1,64}$/.test(error.code)?error.code:'redacted';}
    output.cases.push(result);
  }
  mkdirSync('evidence',{recursive:true});writeFileSync('evidence/exchange-only.json',JSON.stringify(output,null,2));console.log(JSON.stringify(output,null,2));
}catch{console.error('Exchange-only control failed before producing safe evidence.');process.exitCode=1;}
