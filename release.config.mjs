if(process.env.ACCEPTANCE_NPM_PATH)process.env.PATH=process.env.ACCEPTANCE_NPM_PATH+':'+process.env.PATH;
export default {branches:['main',{name:'alpha3',prerelease:true}],tagFormat:'workspace-v${version}',plugins:[['semantic-release-workspace',{publish:true,changelog:true,npm:{trustedPublishing:true,provenance:true,access:'public'}}]]};
