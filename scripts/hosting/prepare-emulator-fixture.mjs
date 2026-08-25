import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assembleHostingRelease } from "./releaseAssembly.mjs";

const stagingRoot = await mkdtemp(join(tmpdir(), "at-hosting-emulator-"));
try {
  const mediaDirectory = join(stagingRoot, "protected-media");
  await mkdir(mediaDirectory);
  const fixture = Buffer.concat([Buffer.from("ATV1"), Buffer.alloc(44, 0xa5)]);
  await writeFile(join(mediaDirectory, "emulator-fixture.atv1"), fixture);
  const result = await assembleHostingRelease({ stagingRoot });
  console.log(
    `Local Hosting emulator fixture prepared (${result.files.length} files).`,
  );
} finally {
  await rm(stagingRoot, { recursive: true, force: true });
}
