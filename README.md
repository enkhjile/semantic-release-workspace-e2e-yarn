# Shared workspace release acceptance (yarn)

This existing public repository exercises the reviewed shared-version candidate on literal `alpha`. `live/core` and `live/app` retain their public identities; `live/private` verifies private workspace exclusion. The app consumes the core through the native workspace dependency form.

`checks.yml` verifies the pinned candidate and native install on pull requests. `live-release.yml` is the only publishing workflow, retains the existing `public-npm` trust environment, and runs only on pushes to `alpha`. Committed setup intent is preview-only. Actual publication requires an exact shared plan, existing identities, registry cleanup completion, retired-version exclusions, and the fixed per-repository budget.

The first clean shared batch legitimately includes the initial package histories. Later core-only and app-only conventional commits test unchanged-member synchronization. A fixed retry-phase hook leaves a fully uploaded pending batch on attempt 1; the same GitHub run retries on a fresh runner with unchanged source and bytes. Stable behavior is tested only in controlled fixtures outside this repository.

Old refs and diagnostic fixtures are archived in the local acceptance report. Deleted registry versions remain permanently reserved in shared-retired-versions.json. Bootstrap1.0.0 may coexist only with the initial shared batch and is then removed separately. No product release or new public identity is created here.
