import {setTimeout as delay} from 'node:timers/promises';
export async function registryJson(url,{ready=()=>true,attempts=20,intervalMs=3000,onAttempt=()=>{}}={}){
  let last;
  for(let attempt=1;attempt<=attempts;attempt++){
    const response=await fetch(url,{headers:{accept:'application/json','cache-control':'no-cache'},signal:AbortSignal.timeout(10000)});
    const record={url,attempt,status:response.status,age:response.headers.get('age')};
    onAttempt(record);last=record;
    if(response.ok){const value=await response.json();if(ready(value))return value;}
    else {await response.body?.cancel();if(![404,429,502,503,504].includes(response.status))throw new Error(`Registry read failed: HTTP${response.status} ${url}`);}
    if(attempt<attempts)await delay(intervalMs);
  }
  throw new Error(`Registry read did not become ready after ${attempts} attempts: HTTP${last?.status} ${url}`);
}
