# Public bootstrap plan

Names: @enkhjile/srw-e2e-yarn-core and @enkhjile/srw-e2e-yarn-app. Initial version1.0.0, app requires core exactly1.0.0. Build copies executable ESM into dist; downstream app exports answer()=>42.

Publish core1.0.0 first, app1.0.0 second with authenticated native npm once ownership is ready. Configure both packages' GitHub publisher for enkhjile/semantic-release-workspace-e2e-yarn, workflow acceptance.yml, environment public-npm, allowing direct publish and dist-tag. Commit functional package source on alpha, then required plugin OIDC/provenance publishes one coordinated prerelease per package. Maximum4uploads total for this repository (2bootstrap+2OIDC); no publication has been performed by this plan.
