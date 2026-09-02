import { LegalPage, LegalSection } from "../../components/legal/LegalPage";

export function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      introduction="This policy explains the information used by A.T IN PHYSICS to provide accounts, enrollments, and authorized learning content."
    >
      <LegalSection title="Information used by the service">
        <p>
          Firebase Authentication processes account information needed for the
          sign-in method you choose, such as your name, email address, phone
          number, authentication identifiers, and sign-in state.
        </p>
        <p>
          The service stores course enrollment status, access-code redemption
          state, course and session relationships, and expiration or revocation
          information where applicable. Plaintext access codes are not stored by
          the platform after generation.
        </p>
        <p>
          Limited technical, operational, and security information may be
          processed when needed to authenticate requests, enforce access,
          diagnose failures, protect content, or maintain the service.
        </p>
      </LegalSection>
      <LegalSection title="How information is used">
        <p>
          Information is used to create and secure accounts, remember the
          selected sign-in persistence, activate access codes, determine course
          enrollment, deliver opened or protected content, manage account
          access, and operate and protect the platform.
        </p>
      </LegalSection>
      <LegalSection title="Protected content">
        <p>
          Authorization checks use your authenticated account and enrollment
          state before protected course metadata, video keys, or session files
          are made available. Protected video may display a privacy-reduced
          viewer watermark derived from authenticated account information to
          discourage unauthorized sharing.
        </p>
      </LegalSection>
      <LegalSection title="Service providers and disclosure">
        <p>
          Firebase services support authentication, database access, and
          Hosting. Information may also be disclosed where reasonably necessary
          to secure the service, comply with applicable legal obligations, or
          protect users and platform rights. The platform does not claim to sell
          personal information.
        </p>
      </LegalSection>
      <LegalSection title="Security and retention">
        <p>
          The service uses authentication, authorization rules, restricted Owner
          operations, encrypted protected-content artifacts, and access
          isolation. No online system can promise absolute security.
        </p>
        <p>
          Information is retained for as long as reasonably needed to operate
          accounts, preserve enrollment and security state, meet applicable
          obligations, and resolve disputes. Retention may vary by information
          type and operational need.
        </p>
      </LegalSection>
      <LegalSection title="Your choices and policy changes">
        <p>
          You can sign out and choose session-only persistence when supported by
          the sign-in flow. Questions about account information or this policy
          can be raised through the established contact channel below.
        </p>
        <p>
          This policy may be updated when the platform or its data practices
          change. The current version will remain available on this page.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
