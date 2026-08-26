import { artifactFixture, fixtureState, playerAudit } from "../playerTestState";

export async function fetchEncryptedMedia(assetId: string): Promise<ArrayBuffer> {
  playerAudit.calls.push(`fetch:${assetId}`);
  if (fixtureState.failure === "fetch") {
    throw new Error("media transport SECRET");
  }
  if (fixtureState.failure === "late") {
    return new Promise((resolve) => {
      fixtureState.lateResolve = resolve;
    });
  }
  if (fixtureState.failure === "atv1") return new Uint8Array([1, 2, 3]).buffer;
  const artifact = await artifactFixture();
  if (fixtureState.failure === "decrypt") {
    const bytes = new Uint8Array(artifact);
    bytes[bytes.length - 1] ^= 1;
  }
  return artifact;
}
