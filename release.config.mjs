if(process.env.ACCEPTANCE_NPM_PATH)process.env.PATH=process.env.ACCEPTANCE_NPM_PATH+':'+process.env.PATH;
export default {branches:['stable7-live',{name:'alpha7-live',prerelease:'alpha7',channel:'alpha'}],tagFormat:'workspace-v${version}',plugins:[['semantic-release-workspace',{publish:true,synchronizeDependents:true,changelog:true,npm:{trustedPublishing:true,provenance:true,access:'public'}}]]};
