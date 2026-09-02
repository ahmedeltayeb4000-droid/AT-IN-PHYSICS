# A.T IN PHYSICS — Owner operations

A.T IN PHYSICS is a Firebase-backed educational platform. The approved production Firebase project is `at-in-physics`. The current MVP uses the Firebase Spark/zero-budget boundary: do not enable billing, add paid infrastructure, or deploy Cloud Functions or Cloud Run.

## Security boundary

The React Admin at `/admin` provides owner-claim-gated inventory and safe draft creation. Sensitive publication, enrollment, access-code, Hosting, and protected-content operations belong to trusted local Owner Control. It listens only on `127.0.0.1`; never expose its port or distribute Admin SDK/Application Default Credentials (ADC).

Never store an Owner UID, ADC credential, Firebase token, access-code plaintext, or content-encryption key in this repository, documentation, screenshots, or support messages.

## Local prerequisites

- Node.js and npm compatible with the checked-in lockfiles.
- The repository-local Firebase CLI for emulator, preflight, Rules, and authorized Hosting workflows.
- Java for Firebase emulator tests.
- Valid ADC for trusted production Owner operations.
- FFmpeg only when local media conversion is needed before current ATV1 packaging; the packager accepts a validated MP4.

Install no new dependency during routine operation. Use the existing dependencies and scripts.

## Start Owner Control

1. Open a normal Windows terminal in the repository root.
2. Set `GOOGLE_CLOUD_PROJECT=at-in-physics` (or `GCLOUD_PROJECT`) and `AT_IN_PHYSICS_OWNER_UID=<verified-owner-uid>` in that terminal. Configure ADC through the trusted local Google credential mechanism; do not put credentials in `.env` or Git.
3. Confirm the UID is the intended Firebase Auth user with the `owner: true` custom claim.
4. Run `START-OWNER-CONTROL.cmd`, or `npm run owner:control`.
5. Confirm project `at-in-physics` and address `http://127.0.0.1:4317`. Close the terminal or press Ctrl+C when finished.

The tool refuses an unapproved project, missing Owner authority, mixed production/emulator configuration, and unsafe operation state.

## Course lifecycle

1. In browser Admin, create a draft Course, its Modules, then draft Sessions using canonical IDs and deliberate ordering.
2. In Owner Control, select the hierarchy, add lesson content and protected assets, and review inventory.
3. Bind required protected content before publishing the Session.
4. Publish Sessions and verify release state and discovery.
5. Publish the Course only after its public metadata and curriculum are ready. Scheduled Sessions remain unavailable until release.
6. Mark a Session free/opened only when public access is intentional; this never replaces Enrollment elsewhere.

## Access-code lifecycle

1. Select a published Course and generate an Access Code in Owner Control.
2. Copy and distribute the plaintext exactly once through the established private channel. It cannot be recovered later and must never be logged or committed.
3. The student redeems it from Dashboard. Redemption atomically consumes the code and creates only the paired Course Enrollment.
4. Inspect code state in Owner Control. Revoke an unused code if compromised or no longer intended. This does not revoke an existing Enrollment.

## Enrollment lifecycle

Locate the exact student UID and Course pair in Owner Control. Review before applying revoke, reactivate, or extend. Revocation removes access while preserving the record. Reactivation is explicit; extension requires a valid future expiry. Verify post-operation state before notifying the student.

## Protected ATV1 video lifecycle

1. Choose the exact Session and prepare a validated MP4 as encrypted ATV1.
2. Review the redacted identity, assemble the local release, and run preflight.
3. Review and explicitly approve Hosting deployment. It deploys the complete audited release, not one isolated file.
4. Require successful remote hash/size verification before reviewing the Firestore binding.
5. Bind the verified artifact to the intended Session, then publish the Session.

For replacement, verify and bind the new artifact through the reviewed replacement flow; do not overwrite bindings manually. Recovery verifies an existing deployment without uploading. Unbind or emergency-withdraw through existing reviewed operations, preserving assets referenced by other production bindings.

## Protected Session PDF lifecycle

1. Choose the exact Session and prepare a genuine PDF through the protected-resource operation.
2. Review the ATR1 ciphertext identity and assemble the release.
3. Run preflight, review Hosting deployment, and require exact remote verification.
4. Bind metadata and access only after verification.
5. Use the reviewed replace/remove lifecycle. Never place plaintext PDFs, descriptors, or keys in `public`, `dist`, `hosting-release`, or Git.

## Emergency withdrawal

Use **Emergency Withdraw** on the exact published Session. Inspect its free, release, video, and resource state, then type the required confirmation. The operation returns it to draft and removes discovery while preserving protected bindings. Refresh inventories and verify absence from enrolled and opened discovery. If verification is uncertain, stop further changes and inspect state before retrying or republishing.

## Production deployment boundary

- **Firestore Rules:** deploy `firestore.rules` separately only after emulator tests and explicit production authorization.
- **Hosting:** assemble `hosting-release`, preserve every authoritative protected artifact, run offline preflight, then use an explicitly authorized Hosting deployment. Owner Control can perform its narrowly guarded asset deployment.
- **Functions:** do not deploy Functions for this MVP. Student redemption and authorization use Firestore and Rules directly.
- Do not add Storage, App Hosting, Cloud Run, or paid services.

The generic Hosting preparation sequence is in `docs/hosting-deployment-runbook.md`. Build, release assembly, review, and preflight never imply deployment.

## Recovery and delivery checklist

1. Confirm `main`, expected HEAD/origin parity, a clean working tree, and empty staged diff.
2. Run lint, build, frontend/backend tests, both Firestore Rules suites, and Hosting release/preflight tests.
3. Inventory every production-bound ATV1/ATR1 route. A replacement release must contain every exact authoritative ciphertext artifact.
4. Review project, target, complete inventory, hashes, sizes, and quota advisory. Never deploy from a dirty tree.
5. After authorized deployment, verify public routes, protected headers, remote hashes/sizes, and bindings. Perform one real student sign-in/enrollment/content smoke without unnecessary production fixtures.

If deployment succeeds but remote verification fails, do not bind; use verification retry or recovery. Use Emergency Withdraw for a Session that must be removed. For a Hosting regression, stop content changes, preserve last verified artifacts and reports, and roll back only under separate reviewed production authorization.
