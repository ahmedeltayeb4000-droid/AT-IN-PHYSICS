import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getContactChannels } from "../src/config/contact.ts";

const source = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("legal routes resolve and registration uses router links", async () => {
  const [router, register, terms, privacy] = await Promise.all([
    source("../src/app/router/AppRouter.tsx"),
    source("../src/pages/auth/RegisterPage.tsx"),
    source("../src/pages/legal/TermsPage.tsx"),
    source("../src/pages/legal/PrivacyPage.tsx"),
  ]);
  assert.match(router, /path="terms" element={<TermsPage \/>}/);
  assert.match(router, /path="privacy" element={<PrivacyPage \/>}/);
  assert.match(register, /<Link className="text-accent" to="\/terms">/);
  assert.match(register, /<Link className="text-accent" to="\/privacy">/);
  assert.match(terms, /Terms of Service/);
  assert.match(privacy, /Privacy Policy/);
});

test("contact UI uses one truthful centralized configuration", async () => {
  const [contact, footer, legal, home] = await Promise.all([
    source("../src/config/contact.ts"),
    source("../src/components/layout/Footer.tsx"),
    source("../src/components/legal/LegalPage.tsx"),
    source("../src/pages/home/HomePage.tsx"),
  ]);
  const visibleSources = `${footer}\n${legal}\n${home}`;
  assert.doesNotMatch(visibleSources, /hello@atinphysics\.com|201000000000/);
  assert.doesNotMatch(visibleSources, /href=["']#contact["']/);
  assert.match(contact, /email: null/);
  assert.match(contact, /whatsappNumber: null/);
  assert.match(contact, /getContactChannels/);
  assert.match(footer, /getContactChannels/);
  assert.match(legal, /getContactChannels/);
  assert.deepEqual(getContactChannels(), []);
  assert.deepEqual(
    getContactChannels({
      email: "owner@example.test",
      whatsappNumber: "201234567890",
    }),
    [
      {
        label: "Email A.T IN PHYSICS",
        href: "mailto:owner@example.test",
      },
      {
        label: "Message A.T IN PHYSICS on WhatsApp",
        href: "https://wa.me/201234567890",
      },
    ],
  );
});

test("auth route loading states remain visible and accessible", async () => {
  const guards = await source("../src/features/auth/AuthGuards.tsx");
  assert.match(guards, /function AuthLoadingState/);
  assert.match(guards, /role="status"/);
  assert.match(guards, /Checking your account/);
  assert.doesNotMatch(guards, /if \(loading\) \{\s*return null;/);
});

test("Owner runbook documents the trusted boundary without embedded secrets", async () => {
  const readme = await source("../README.md");
  assert.match(readme, /127\.0\.0\.1:4317/);
  assert.match(readme, /AT_IN_PHYSICS_OWNER_UID=<verified-owner-uid>/);
  assert.match(readme, /do not deploy Functions/i);
  assert.match(readme, /Emergency Withdraw/);
  assert.doesNotMatch(readme, /-----BEGIN (?:PRIVATE KEY|CERTIFICATE)-----/);
});
