import { expect, test } from "@playwright/test";

const fixture = "/test/browser/player.fixture.html";
const localTestOrigins = new Set(["http://127.0.0.1:4173", "http://localhost:4173"]);
let blockedExternalRequests: string[] = [];

test.beforeEach(async ({ context }) => {
  blockedExternalRequests = [];
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if ((url.protocol === "http:" || url.protocol === "https:") && !localTestOrigins.has(url.origin)) {
      blockedExternalRequests.push(url.href);
      await route.abort("blockedbyclient");
      return;
    }
    await route.continue();
  });
});

test.afterEach(() => {
  expect(blockedExternalRequests, "browser tests must never request a non-local HTTP(S) origin").toEqual([]);
});

test("harness resolves only test media boundaries and cannot load Firebase production modules", async ({ page }) => {
  await page.goto(fixture);
  await expect(page.locator("video")).toBeVisible();

  const evidence = await page.evaluate(async () => {
    const playerSource = await fetch("/src/features/video/SessionVideoPlayer.tsx").then((response) =>
      response.text(),
    );
    const resources = performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter((url) => /^https?:/i.test(url));
    const forbiddenResponses = await Promise.all(
      [
        "/src/features/courses/videoAccessRepository.ts",
        "/src/features/video/encryptedMediaRepository.ts",
        "/src/lib/firebase.ts",
      ].map(async (path) => ({ path, ok: (await fetch(path)).ok })),
    );
    return { playerSource, forbiddenResponses, resources };
  });

  expect(evidence.playerSource).toContain("/test/browser/mocks/videoAccessRepository.ts");
  expect(evidence.playerSource).toContain("/test/browser/mocks/encryptedMediaRepository.ts");
  expect(evidence.playerSource).not.toContain("/src/features/courses/videoAccessRepository");
  expect(evidence.playerSource).not.toContain("/src/features/video/encryptedMediaRepository");
  expect(evidence.playerSource).not.toMatch(/firebase(?:\/|%2f)|@firebase|at-in-physics/i);
  expect(evidence.forbiddenResponses).toEqual([
    { path: "/src/features/courses/videoAccessRepository.ts", ok: false },
    { path: "/src/features/video/encryptedMediaRepository.ts", ok: false },
    { path: "/src/lib/firebase.ts", ok: false },
  ]);
  expect(evidence.resources.every((url) => localTestOrigins.has(new URL(url).origin))).toBe(true);
  expect(evidence.resources.join("\n")).not.toMatch(
    /firebase|firestore|identitytoolkit|googleapis|at-in-physics/i,
  );
});

test("protected playback orders access before media and renders privacy-safe watermark", async ({ page }) => {
  await page.goto(fixture);
  const player = page.locator('[data-watermark-policy="protected"]');
  const video = player.locator("video");
  await expect(video).toBeVisible();
  await expect(video).toHaveAttribute("controls", "");
  await video.focus();
  await expect(video).toBeFocused();
  const watermark = player.locator("[data-watermark-position]");
  await expect(watermark).toContainText("A.T IN PHYSICS");
  await expect(watermark).toContainText("a***t@e***e.com");
  await expect(watermark).not.toContainText("alice.student@example.com");
  await expect(watermark).not.toContainText("viewer-one-raw-uid");
  await expect(watermark).toHaveCSS("pointer-events", "none");
  const calls = await page.evaluate(() => window.playerAudit.calls);
  expect(calls.indexOf("access:lesson-one")).toBeLessThan(calls.indexOf("fetch:lesson-one-video"));
  expect(calls.indexOf("fetch:lesson-one-video")).toBeLessThan(calls.indexOf("blob:video/mp4"));
  expect(await video.getAttribute("src")).toMatch(/^blob:/);
});

test("position cycles once, remains bounded, and viewer/session changes clean lifecycle", async ({ page }) => {
  await page.clock.install();
  await page.goto(fixture);
  const watermark = page.locator("[data-watermark-position]");
  await expect(watermark).toBeVisible();
  const before = await watermark.getAttribute("data-watermark-position");
  await page.clock.fastForward(12_001);
  await expect(watermark).not.toHaveAttribute("data-watermark-position", before!);
  expect(await page.evaluate(() => window.playerAudit.watermarkTimers.size)).toBe(1);

  await page.getByRole("button", { name: "Change viewer" }).click();
  await expect(watermark).toContainText("b***r@e***e.com");
  await expect(watermark).not.toContainText("viewer-one-raw-uid");
  await page.getByRole("button", { name: "Change session" }).click();
  await expect(page.locator("video")).toBeVisible();
  expect(await page.evaluate(() => window.playerAudit.watermarkTimers.size)).toBe(1);
  expect(await page.evaluate(() => window.playerAudit.revokedUrls.length)).toBeGreaterThan(0);
});

test("reduced motion fixes position and responds to preference changes", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.clock.install();
  await page.goto(fixture);
  const watermark = page.locator("[data-watermark-position]");
  await expect(watermark).toHaveAttribute("data-watermark-position", "0");
  expect(await page.evaluate(() => window.playerAudit.watermarkTimers.size)).toBe(0);
  await page.clock.fastForward(24_001);
  await expect(watermark).toHaveAttribute("data-watermark-position", "0");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect.poll(() => page.evaluate(() => window.playerAudit.watermarkTimers.size)).toBe(1);
});

test("wrapper fullscreen is accessible and retains watermark when supported", async ({ page, browserName }) => {
  await page.goto(fixture);
  const player = page.locator('[data-watermark-policy="protected"]');
  const button = player.locator('button[aria-pressed]');
  await button.focus();
  await expect(button).toBeFocused();
  await expect(button).toHaveAccessibleName("Enter video fullscreen");
  await expect(button).toHaveAttribute("aria-pressed", "false");
  await button.click();
  const entered = await page
    .waitForFunction(() => document.fullscreenElement !== null, undefined, { timeout: 2_000 })
    .then(() => true)
    .catch(() => false);
  test.skip(!entered, `${browserName} could not genuinely enter fullscreen in this headless environment`);
  await expect(button).toHaveAttribute("aria-pressed", "true");
  await expect(button).toHaveAccessibleName("Exit video fullscreen");
  expect(await page.evaluate(() => document.fullscreenElement?.getAttribute("data-watermark-policy"))).toBe("protected");
  await expect(player.locator("[data-watermark-position]")).toBeVisible();
  await button.click();
  await expect(button).toHaveAttribute("aria-pressed", "false");
});

test("fullscreen rejection is sanitized and playback remains usable", async ({ page }) => {
  await page.addInitScript(() => {
    HTMLElement.prototype.requestFullscreen = async () => { throw new Error("fullscreen internal SECRET"); };
  });
  await page.goto(fixture);
  await page.getByRole("button", { name: "Enter video fullscreen" }).click();
  await expect(page.locator("video")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("fullscreen internal SECRET");
});

test("unmount and late completion release URLs and remove listeners and timers", async ({ page }) => {
  await page.goto(fixture);
  await expect(page.locator("video")).toBeVisible();
  await page.getByRole("button", { name: "Unmount player" }).click();
  expect(await page.evaluate(() => window.playerAudit.watermarkTimers.size)).toBe(0);
  expect(await page.evaluate(() => window.playerAudit.mediaListeners)).toBe(0);
  expect(await page.evaluate(() => window.playerAudit.fullscreenListeners)).toBe(0);
  expect(await page.evaluate(() => window.playerAudit.revokedUrls.length)).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Late media" }).click();
  await page.getByRole("button", { name: "Mount player", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.playerAudit.calls.at(-1))).toContain("fetch:");
  const createdBeforeLateResolve = await page.evaluate(() => window.playerAudit.createdUrls.length);
  await page.getByRole("button", { name: "Unmount player" }).click();
  await page.getByRole("button", { name: "Resolve late" }).click();
  await expect.poll(() => page.evaluate(
    (before) =>
      window.playerAudit.createdUrls.length > before &&
      window.playerAudit.createdUrls.length === window.playerAudit.revokedUrls.length,
    createdBeforeLateResolve,
  )).toBe(true);
});

for (const failure of ["access", "fetch", "key", "atv1", "decrypt"] as const) {
  test(`${failure} failure is sanitized and stops later protected stages`, async ({ page }) => {
    await page.goto(fixture);
    await expect(page.locator("video")).toBeVisible();
    const callOffset = await page.evaluate(() => window.playerAudit.calls.length);
    await page.getByRole("button", { name: "Unmount player" }).click();
    await page.getByRole("button", { name: `Fail ${failure}` }).click();
    await page.getByRole("button", { name: "Mount player", exact: true }).click();
    await expect(page.getByText("Video is unavailable. You can still read the lesson below.")).toBeVisible();
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/SECRET|OperationError|permission denied|contentKey/);
    const calls = await page.evaluate((offset) => window.playerAudit.calls.slice(offset), callOffset);
    if (failure === "access") expect(calls.some((call) => call.startsWith("fetch:"))).toBe(false);
    expect(calls.some((call) => call.startsWith("blob:"))).toBe(false);
  });
}

test("explicit none policy opts out without changing the protected player architecture", async ({ page }) => {
  await page.goto(fixture);
  await page.getByRole("button", { name: "No watermark" }).click();
  await expect(page.locator('[data-watermark-policy="none"] video')).toBeVisible();
  await expect(page.locator("[data-watermark-position]")).toHaveCount(0);
});
