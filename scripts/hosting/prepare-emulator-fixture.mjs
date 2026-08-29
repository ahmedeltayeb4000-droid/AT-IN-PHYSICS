import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assembleHostingRelease } from "./releaseAssembly.mjs";

const firebaseConfig = JSON.parse(
  await readFile(new URL("../../firebase.json", import.meta.url), "utf8"),
);
delete firebaseConfig.hosting.target;
firebaseConfig.hosting.public = "../hosting-release";
const emulatorConfigDirectory = new URL(
  "../../hosting-emulator-config/",
  import.meta.url,
);
await mkdir(emulatorConfigDirectory, { recursive: true });
await writeFile(
  new URL("firebase.json", emulatorConfigDirectory),
  `${JSON.stringify(firebaseConfig, null, 2)}\n`,
);

const stagingRoot = await mkdtemp(join(tmpdir(), "at-hosting-emulator-"));
try {
  const mediaDirectory = join(stagingRoot, "protected-media");
  await mkdir(mediaDirectory);
  const fixture = Buffer.concat([Buffer.from("ATV1"), Buffer.alloc(44, 0xa5)]);
  await writeFile(join(mediaDirectory, "emulator-fixture.atv1"), fixture);
  const resourceDirectory = join(
    stagingRoot,
    "protected-resources/courses/mechanics/resources",
  );
  await mkdir(resourceDirectory, { recursive: true });
  const resourceFixture = Buffer.concat([
    Buffer.from("ATR1"),
    Buffer.alloc(44, 0xb6),
  ]);
  await writeFile(join(resourceDirectory, "emulator-notes.atr1"), resourceFixture);
  const result = await assembleHostingRelease({ stagingRoot });
  console.log(
    `Local Hosting emulator fixture prepared (${result.files.length} files).`,
  );
} finally {
  await rm(stagingRoot, { recursive: true, force: true });
}
