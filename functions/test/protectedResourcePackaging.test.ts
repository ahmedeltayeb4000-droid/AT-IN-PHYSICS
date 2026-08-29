import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { decryptProtectedResource } from "../src/protectedResources/crypto.js";
import { PROTECTED_RESOURCE_MAX_PLAINTEXT_SIZE } from "../src/protectedResources/format.js";
import {
  DEFAULT_PROTECTED_RESOURCE_STAGING_ROOT,
  packageProtectedResource,
} from "../src/tooling/protectedResourcePackaging.js";

const execFileAsync = promisify(execFile);

const PDF = Buffer.from("%PDF-1.7\nsynthetic Sprint 3 fixture\n%%EOF\n");
const COURSE_SCOPE = { type: "course", courseId: "mechanics" } as const;
const SESSION_SCOPE = {
  type: "session",
  courseId: "mechanics",
  moduleId: "motion",
  sessionId: "introduction",
} as const;

async function temporary(
  callback: (fixture: {
    root: string;
    inputFile: string;
    stagingRoot: string;
    descriptorRoot: string;
  }) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "at-resource-package-"));
  const inputFile = join(root, "notes.pdf");
  await writeFile(inputFile, PDF);
  try {
    await callback({
      root,
      inputFile,
      stagingRoot: join(root, "staging"),
      descriptorRoot: join(root, "descriptors"),
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function input(scope: unknown, inputFile: string, overrides = {}) {
  return {
    scope,
    resourceId: "motion-notes",
    title: "Motion notes",
    originalFileName: "notes.pdf",
    mimeType: "application/pdf",
    inputFile,
    ...overrides,
  };
}

test("Course packaging stages exact ATR1, safe identity, and decryptable bytes", async () =>
  temporary(async ({ inputFile, stagingRoot, descriptorRoot }) => {
    const result = await packageProtectedResource(input(COURSE_SCOPE, inputFile), {
      stagingRoot,
      descriptorRoot,
    });
    const artifact = await readFile(result.stagingDestination);
    assert.equal(
      result.identity.ciphertextRoute,
      "/protected-resources/courses/mechanics/resources/motion-notes.atr1",
    );
    assert.equal(
      result.stagingDestination,
      join(
        stagingRoot,
        "protected-resources",
        "courses",
        "mechanics",
        "resources",
        "motion-notes.atr1",
      ),
    );
    assert.equal(artifact.subarray(0, 4).toString("ascii"), "ATR1");
    assert.notDeepEqual(artifact, PDF);
    assert.equal(artifact.length, PDF.length + 32);
    assert.equal(result.identity.ciphertextSize, PDF.length + 32);
    assert.equal(
      result.identity.ciphertextSha256,
      createHash("sha256").update(artifact).digest("hex"),
    );
    assert.match(result.identity.ciphertextSha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(decryptProtectedResource(artifact, result.contentKey), PDF);

    const descriptorText = await readFile(result.descriptorPath, "utf8");
    assert.deepEqual(JSON.parse(descriptorText), result.identity);
    assert.equal(descriptorText.includes(result.contentKey), false);
    assert.equal("contentKey" in result.identity, false);
    assert.equal("createdAt" in result.identity, false);
    assert.equal("boundAt" in result.identity, false);
    assert.equal(result.stagingDestination.includes(result.contentKey), false);
    assert.equal(result.descriptorPath.includes(result.contentKey), false);
  }));

test("Session packaging derives the exact nested route and destination", async () =>
  temporary(async ({ inputFile, stagingRoot, descriptorRoot }) => {
    const result = await packageProtectedResource(
      input(SESSION_SCOPE, inputFile),
      { stagingRoot, descriptorRoot },
    );
    assert.equal(
      result.identity.ciphertextRoute,
      "/protected-resources/courses/mechanics/modules/motion/sessions/introduction/resources/motion-notes.atr1",
    );
    assert.equal(
      result.stagingDestination,
      join(
        stagingRoot,
        "protected-resources",
        "courses",
        "mechanics",
        "modules",
        "motion",
        "sessions",
        "introduction",
        "resources",
        "motion-notes.atr1",
      ),
    );
  }));

test("input contracts reject unsafe metadata before emitting ciphertext", async () =>
  temporary(async ({ inputFile, stagingRoot, descriptorRoot }) => {
    const invalid = [
      { originalFileName: "notes.txt" },
      { originalFileName: "notes.PDF" },
      { originalFileName: "../notes.pdf" },
      { originalFileName: "folder/notes.pdf" },
      { originalFileName: "CON.pdf" },
      { title: " bad title" },
      { resourceId: "Bad" },
      { scope: { type: "course", courseId: "Bad" } },
      { scope: { ...SESSION_SCOPE, moduleId: "Bad" } },
      { scope: { ...SESSION_SCOPE, sessionId: "Bad" } },
      { mimeType: "text/plain" },
    ];
    for (const overrides of invalid) {
      await assert.rejects(
        packageProtectedResource(input(COURSE_SCOPE, inputFile, overrides), {
          stagingRoot,
          descriptorRoot,
        }),
      );
    }
    await assert.rejects(readdir(stagingRoot));
  }));

test("empty, oversized, and fake PDF inputs fail without output", async () =>
  temporary(async ({ root, stagingRoot, descriptorRoot }) => {
    for (const [name, bytes] of [
      ["empty.pdf", Buffer.alloc(0)],
      ["fake.pdf", Buffer.from("not a PDF")],
      [
        "large.pdf",
        Buffer.concat([
          Buffer.from("%PDF-"),
          Buffer.alloc(PROTECTED_RESOURCE_MAX_PLAINTEXT_SIZE - 4),
        ]),
      ],
    ] as const) {
      const inputFile = join(root, name);
      await writeFile(inputFile, bytes);
      await assert.rejects(
        packageProtectedResource(
          input(COURSE_SCOPE, inputFile, { originalFileName: name }),
          { stagingRoot, descriptorRoot },
        ),
      );
    }
    await assert.rejects(readdir(stagingRoot));
  }));

test("fresh randomness changes key and ciphertext; wrong key and tampering fail", async () =>
  temporary(async ({ root, inputFile }) => {
    const first = await packageProtectedResource(input(COURSE_SCOPE, inputFile), {
      stagingRoot: join(root, "s1"),
      descriptorRoot: join(root, "d1"),
    });
    const second = await packageProtectedResource(input(COURSE_SCOPE, inputFile), {
      stagingRoot: join(root, "s2"),
      descriptorRoot: join(root, "d2"),
    });
    const firstArtifact = await readFile(first.stagingDestination);
    const secondArtifact = await readFile(second.stagingDestination);
    assert.notEqual(first.contentKey, second.contentKey);
    assert.notDeepEqual(firstArtifact, secondArtifact);
    assert.throws(() =>
      decryptProtectedResource(firstArtifact, second.contentKey),
    );
    firstArtifact[20] ^= 1;
    assert.throws(() => decryptProtectedResource(firstArtifact, first.contentKey));
  }));

test("caller route injection is ignored and cannot escape trusted roots", async () =>
  temporary(async ({ inputFile, stagingRoot, descriptorRoot }) => {
    const result = await packageProtectedResource(
      input(COURSE_SCOPE, inputFile, {
        ciphertextRoute: "/../../plaintext.pdf",
        outputPath: "../../plaintext.pdf",
      }),
      { stagingRoot, descriptorRoot },
    );
    assert.equal(
      result.identity.ciphertextRoute,
      "/protected-resources/courses/mechanics/resources/motion-notes.atr1",
    );
    assert.equal(result.stagingDestination.endsWith(".atr1"), true);
    assert.equal(result.stagingDestination.startsWith(stagingRoot), true);
  }));

test("collisions never overwrite and descriptor failure rolls back ciphertext", async () =>
  temporary(async ({ inputFile, stagingRoot, descriptorRoot }) => {
    const first = await packageProtectedResource(input(COURSE_SCOPE, inputFile), {
      stagingRoot,
      descriptorRoot,
    });
    const originalArtifact = await readFile(first.stagingDestination);
    await assert.rejects(
      packageProtectedResource(input(COURSE_SCOPE, inputFile), {
        stagingRoot,
        descriptorRoot,
      }),
      /could not be written/,
    );
    assert.deepEqual(await readFile(first.stagingDestination), originalArtifact);

    await rm(first.stagingDestination);
    await assert.rejects(
      packageProtectedResource(input(COURSE_SCOPE, inputFile), {
        stagingRoot,
        descriptorRoot,
      }),
      /could not be written/,
    );
    await assert.rejects(readFile(first.stagingDestination));
  }));

test("Hosting staging contains ciphertext only and no plaintext PDF", async () =>
  temporary(async ({ inputFile, stagingRoot, descriptorRoot }) => {
    await packageProtectedResource(input(COURSE_SCOPE, inputFile), {
      stagingRoot,
      descriptorRoot,
    });
    const files: string[] = [];
    async function walk(directory: string): Promise<void> {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) await walk(path);
        else files.push(path);
      }
    }
    await walk(stagingRoot);
    assert.equal(files.length, 1);
    assert.equal(files[0]!.endsWith(".atr1"), true);
    assert.equal(files.some((path) => path.endsWith(".pdf")), false);
    assert.equal((await readFile(files[0]!)).includes(PDF), false);
  }));

test("private descriptors and local staging are Git-ignored with no tracked PDF fixture", async () => {
  const repositoryRoot = join(DEFAULT_PROTECTED_RESOURCE_STAGING_ROOT, "..");
  for (const path of [
    "protected-resource-packages/example.package.json",
    "hosting-video-staging/protected-resources/example.atr1",
  ]) {
    await execFileAsync(
      "git",
      ["check-ignore", "--quiet", "--no-index", path],
      { cwd: repositoryRoot },
    );
  }
  const { stdout } = await execFileAsync("git", ["ls-files", "*.pdf"], {
    cwd: repositoryRoot,
  });
  assert.equal(stdout.trim(), "");
});
