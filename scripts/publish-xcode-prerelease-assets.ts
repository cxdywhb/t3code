#!/usr/bin/env node
// @effect-diagnostics-next-line nodeBuiltinImport:off -- Node's incremental digests hash installers without buffering them.
import * as NodeCrypto from "node:crypto";
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Console from "effect/Console";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { Argument, Command, Flag } from "effect/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { parseUpdateManifest, serializeUpdateManifest } from "./lib/update-manifest.ts";

const repository = "cxdywhb/t3code";
const Release = Schema.fromJsonString(
  Schema.Struct({
    isPrerelease: Schema.Boolean,
    assets: Schema.Array(
      Schema.Struct({ name: Schema.String, digest: Schema.NullOr(Schema.String) }),
    ),
  }),
);

class ReleaseAssetError extends Schema.TaggedError<ReleaseAssetError>()("ReleaseAssetError", {
  message: Schema.String,
}) {}

const readAsset = Effect.fn("readXCodeReleaseAsset")(function* (directory: string, name: string) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const file = path.resolve(directory, name);
  const info = yield* fs.stat(file);
  if (info.type !== "File" || info.size === 0n) {
    return yield* new ReleaseAssetError({ message: `需要非空发布附件 ${file}` });
  }
  const sha256 = NodeCrypto.createHash("sha256");
  const sha512 = NodeCrypto.createHash("sha512");
  yield* Stream.runForEach(fs.stream(file), (chunk) =>
    Effect.sync(() => {
      sha256.update(chunk);
      sha512.update(chunk);
    }),
  );
  return {
    name,
    file,
    url: name,
    size: Number(info.size),
    sha256: sha256.digest("hex"),
    sha512: sha512.digest("base64"),
  };
});

const requireUpdaterManifest = Effect.fn("requireXCodeUpdaterManifest")(function* (
  directory: string,
  name: string,
  version: string,
  installers: ReadonlyArray<{
    readonly url: string;
    readonly size: number;
    readonly sha512: string;
  }>,
) {
  const fs = yield* FileSystem.FileSystem;
  const asset = yield* readAsset(directory, name);
  const raw = yield* fs.readFileString(asset.file);
  const manifest = yield* Effect.try({
    try: () => parseUpdateManifest(raw, asset.file, name),
    catch: (cause) => new ReleaseAssetError({ message: String(cause) }),
  });
  if (
    manifest.version !== version ||
    manifest.files.length !== installers.length ||
    installers.some(
      (installer) =>
        !manifest.files.some(
          (entry) =>
            entry.url === installer.url &&
            entry.size === installer.size &&
            entry.sha512 === installer.sha512,
        ),
    )
  ) {
    return yield* new ReleaseAssetError({ message: `更新清单与安装包不匹配 ${asset.file}` });
  }
  const topLevel = Object.fromEntries(
    raw.split(/\r?\n/u).flatMap((line) => {
      const field = /^(path|sha512):\s*(.+)$/u.exec(line);
      return field ? [[field[1], field[2]?.replace(/^'|'$/gu, "")]] : [];
    }),
  );
  if (topLevel.path !== installers[0]?.url || topLevel.sha512 !== installers[0]?.sha512) {
    return yield* new ReleaseAssetError({
      message: `更新清单的 path 或 SHA-512 不匹配 ${asset.file}`,
    });
  }
  return asset;
});

const command = Command.make(
  "publish-xcode-prerelease-assets",
  {
    version: Argument.String("version").pipe(
      Argument.withSchema(Schema.String.check(Schema.isPattern(/^\d+\.\d+\.\d+$/u))),
    ),
    macDir: Flag.String("mac-dir"),
    winDir: Flag.String("win-dir"),
    generateMacManifest: Flag.Boolean("generate-mac-manifest").pipe(Flag.withDefault(false)),
    publish: Flag.Boolean("publish").pipe(Flag.withDefault(false)),
  },
  ({ version, macDir, winDir, generateMacManifest, publish }) =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const macZip = yield* readAsset(macDir, `X-Code-${version}-arm64.zip`);
        const macDmg = yield* readAsset(macDir, `X-Code-${version}-arm64.dmg`);
        const windows = yield* readAsset(winDir, `X-Code-${version}-x64.exe`);
        const blockmaps = yield* Effect.forEach(
          [
            [macDir, macZip],
            [macDir, macDmg],
            [winDir, windows],
          ] as const,
          ([directory, installer]) => readAsset(directory, `${installer.name}.blockmap`),
        );
        if (generateMacManifest && !(yield* fs.exists(path.join(macDir, "latest-mac.yml")))) {
          const manifest = serializeUpdateManifest(
            {
              version,
              files: [macZip, macDmg],
              extras: {},
              releaseDate: DateTime.formatIso(yield* DateTime.now),
            },
            { platformLabel: "macOS" },
          );
          yield* fs.writeFileString(
            path.join(macDir, "latest-mac.yml"),
            manifest + `path: ${macZip.url}\nsha512: ${macZip.sha512}\n`,
          );
        }

        const macManifest = yield* requireUpdaterManifest(macDir, "latest-mac.yml", version, [
          macZip,
          macDmg,
        ]);
        const winManifest = yield* requireUpdaterManifest(winDir, "latest.yml", version, [windows]);
        const files = [macZip, macDmg, windows, ...blockmaps, macManifest, winManifest];
        const temporary = yield* fs.makeTempDirectoryScoped({ prefix: "xcode-release-assets-" });
        yield* fs.writeFileString(
          path.join(temporary, "SHA256SUMS.txt"),
          files.map(({ name, sha256 }) => `${sha256}  ${name}\n`).join(""),
        );
        const assets = [...files, yield* readAsset(temporary, "SHA256SUMS.txt")];

        if (publish) {
          const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
          const tag = `v${version}`;
          const readRelease = spawner
            .string(
              ChildProcess.make("gh", [
                "release",
                "view",
                tag,
                "--repo",
                repository,
                "--json",
                "isPrerelease,assets",
              ]),
            )
            .pipe(Effect.flatMap(Schema.decodeEffect(Release)));
          const before = yield* readRelease;
          if (!before.isPrerelease) {
            return yield* new ReleaseAssetError({ message: `${tag} 必须是 GitHub 预发布版本` });
          }
          for (const { name, file, sha256 } of assets) {
            if (
              before.assets.some(
                (entry) => entry.name === name && entry.digest === `sha256:${sha256}`,
              )
            )
              continue;
            yield* spawner.string(
              ChildProcess.make("gh", [
                "release",
                "upload",
                tag,
                file,
                "--repo",
                repository,
                "--clobber",
              ]),
            );
          }
          const after = yield* readRelease;
          for (const { name, sha256 } of assets) {
            if (
              !after.assets.some(
                (entry) => entry.name === name && entry.digest === `sha256:${sha256}`,
              )
            ) {
              return yield* new ReleaseAssetError({ message: `GitHub 附件缺失或校验失败 ${name}` });
            }
          }
        }
        yield* Console.log(assets.map(({ name, sha256 }) => `${sha256}  ${name}`).join("\n"));
      }),
    ),
).pipe(
  Command.withDescription("Validate and upload complete X Code macOS and Windows updater assets."),
);

if (import.meta.main) {
  Command.run(command, { version: "0.0.0" }).pipe(
    Effect.provide(NodeServices.layer),
    NodeRuntime.runMain,
  );
}
