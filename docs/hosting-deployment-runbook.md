# Classic Firebase Hosting publication runbook

This workflow is owner-controlled and does not enable billing or use Storage,
Functions, Cloud Run, or App Hosting.

1. Prepare and test the ignored release locally:

   `npm run hosting:release:test`

2. Ensure all intended source changes are reviewed and committed. The preflight
   refuses a dirty Git tree.

3. Run the offline preflight with the target typed twice:

   `npm run hosting:deploy:preflight -- --project at-in-physics --expect-project at-in-physics`

4. Review `hosting-deploy-preflight/preflight.json`, including the commit,
   Firebase configuration fingerprint, complete file inventory, hashes, sizes,
   quota advisory, and `NOTHING DEPLOYED` outcome.

5. Stop. This repository intentionally has no deployment script. A future owner
   decision would require a separately typed command conceptually shaped as
   `firebase deploy --only hosting --project <explicit-project-id>`. Do not run
   it unless a later sprint explicitly authorizes deployment.
