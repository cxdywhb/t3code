// @effect-diagnostics nodeBuiltinImport:off - Test release files in an isolated temporary directory.
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, expect, it } from "vite-plus/test";

import { serializeUpdateManifest } from "./lib/update-manifest.ts";
import { verifyMacUpdateAssets } from "./release-xcode-mac.ts";

const version = "0.1.25";
const zip = `X-Code-${version}-arm64.zip`;
const dmg = `X-Code-${version}-arm64.dmg`;
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((dir) => NodeFSP.rm(dir, { recursive: true, force: true })),
  );
});

async function assetsFixture() {
  const directory = await NodeFSP.mkdtemp(
    NodePath.join(NodeOS.tmpdir(), "xcode-update-assets-test-"),
  );
  directories.push(directory);
  const files = await Promise.all(
    [zip, dmg].map(async (url) => {
      const content = Buffer.from(url);
      await NodeFSP.writeFile(NodePath.join(directory, url), content);
      await NodeFSP.writeFile(NodePath.join(directory, `${url}.blockmap`), "test blockmap");
      return {
        url,
        size: content.length,
        sha512: NodeCrypto.createHash("sha512").update(content).digest("base64"),
      };
    }),
  );
  await NodeFSP.writeFile(
    NodePath.join(directory, "latest-mac.yml"),
    serializeUpdateManifest(
      {
        version,
        releaseDate: "2026-11-27T00:00:00.000Z",
        files,
        extras: {},
      },
      { platformLabel: "macOS" },
    ),
  );
  return directory;
}

it("collects all updater assets from a matching build", async () => {
  const dir = await assetsFixture();
  expect(await verifyMacUpdateAssets(dir, version)).toEqual([
    "latest-mac.yml",
    dmg,
    `${dmg}.blockmap`,
    zip,
    `${zip}.blockmap`,
  ]);
});

it.each(["latest-mac.yml", zip, `${zip}.blockmap`])(
  "rejects a release missing %s",
  async (name) => {
    const dir = await assetsFixture();
    await NodeFSP.rm(NodePath.join(dir, name));
    await expect(verifyMacUpdateAssets(dir, version)).rejects.toThrow(name);
  },
);

it("rejects a manifest from a different version or a ZIP with stale checksums", async () => {
  const dir = await assetsFixture();
  await expect(verifyMacUpdateAssets(dir, "0.1.26")).rejects.toThrow("0.1.26");
  await NodeFSP.writeFile(NodePath.join(dir, zip), "x".repeat(zip.length));
  await expect(verifyMacUpdateAssets(dir, version)).rejects.toThrow("SHA-512");
});
