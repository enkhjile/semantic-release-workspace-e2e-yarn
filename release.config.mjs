if(process.env.ACCEPTANCE_NPM_PATH)process.env.PATH=process.env.ACCEPTANCE_NPM_PATH+':'+process.env.PATH;
export default {branches:['main',{name:'alpha4-live',channel:'alpha4',prerelease:'alpha4'}],tagFormat:'workspace-v${version}',plugins:[['semantic-release-workspace',{publish:true,changelog:true,npm:{trustedPublishing:true,provenance:true,access:'public'}}]]};
