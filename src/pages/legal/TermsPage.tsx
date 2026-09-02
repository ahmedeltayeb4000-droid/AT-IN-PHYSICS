import { LegalPage, LegalSection } from "../../components/legal/LegalPage";

export function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      introduction="These terms govern your use of the A.T IN PHYSICS educational platform and its learning content. By creating an account or using the service, you agree to follow them."
    >
      <LegalSection title="Accounts and access">
        <p>
          You are responsible for providing accurate account information,
          protecting your sign-in credentials, and keeping activity under your
          account authorized.
        </p>
        <p>
          Enrollment and access codes apply only to the intended course and
          account. Do not sell, publish, reuse, or share credentials or access
          codes. An access code may be single-use, expire, or be revoked before
          redemption.
        </p>
      </LegalSection>
      <LegalSection title="Courses and learning content">
        <p>
          Course availability, session release times, and enrollment duration
          may vary. Opened sessions may be viewed without enrollment, but they
          do not grant access to protected courses or files.
        </p>
        <p>
          Access is personal and limited to viewing or downloading content
          through the features provided by the service. You may not copy,
          redistribute, record, republish, sell, bypass protection on, or
          provide unauthorized access to course videos, files, or materials.
        </p>
      </LegalSection>
      <LegalSection title="Acceptable use">
        <p>
          Do not interfere with the service, attempt to access another user’s
          account or enrollment, probe protected systems, evade technical
          restrictions, or use the service unlawfully. We may suspend or
          terminate access where reasonably necessary to address abuse, security
          risks, or a material breach of these terms.
        </p>
      </LegalSection>
      <LegalSection title="Service availability">
        <p>
          We aim to keep the service available and learning content accurate,
          but uninterrupted availability, error-free operation, and specific
          academic results are not guaranteed. Maintenance, connectivity, device
          limitations, or events outside reasonable control may affect access.
        </p>
      </LegalSection>
      <LegalSection title="Educational disclaimer">
        <p>
          A.T IN PHYSICS provides educational material and study support. It
          does not guarantee examination results, grades, admission,
          certification, or suitability for every curriculum or individual
          learning need.
        </p>
      </LegalSection>
      <LegalSection title="Changes to these terms">
        <p>
          These terms may be updated when the service or its practices change.
          The current version will be published on this page. Continued use
          after an update means the revised terms apply from that point.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
