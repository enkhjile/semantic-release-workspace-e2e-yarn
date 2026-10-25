// DIAGNOSTIC_LIVE_OIDC: unchanged public alpha.2 plus public ESM-resolution workaround.
import {fileURLToPath} from 'node:url';
const plugin=fileURLToPath(import.meta.resolve('semantic-release-workspace'));
if(process.env.DIAGNOSTIC_NPM_BIN)process.env.PATH=process.env.DIAGNOSTIC_NPM_BIN+':'+process.env.PATH;
const inventory=process.env.SRW_LIVE_INVENTORY==='1';
export default {branches:['main',{name:'alpha',prerelease:true}],tagFormat:'workspace-v${version}',plugins:[[plugin,{publish:!inventory,changelog:true,npm:{trustedPublishing:!inventory,provenance:!inventory,access:'public'}}]]};
