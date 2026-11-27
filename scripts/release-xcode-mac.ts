#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - One-shot packaging and GitHub release command.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";
import { compareSemverVersions } from "@t3tools/shared/semver";

import { parseUpdateManifest } from "./lib/update-manifest.ts";

const repository = "cxdywhb/t3code";
const manifestName = "latest-mac.yml";
const sumsName = "SHA256SUMS.txt";

async function hashFile(file: string, algorithm: "sha256" | "sha512") {
  const hash = NodeCrypto.createHash(algorithm);
  for await (const chunk of NodeFS.createReadStream(file)) hash.update(chunk);
  return hash;
}

function macArtifacts(version: string) {
  const base = `X-Code-${version}-arm64`;
  return { dmg: `${base}.dmg`, zip: `${base}.zip` };
}

export async function verifyMacUpdateAssets(directory: string, version: string) {
  const { zip, dmg } = macArtifacts(version);
  const manifestPath = NodePath.join(directory, manifestName);
  const manifest = parseUpdateManifest(
    await NodeFSP.readFile(manifestPath, "utf8"),
    manifestPath,
    "macOS",
  );
  if (manifest.version !== version) throw new Error(`更新清单版本必须是 ${version}`);
  if (manifest.files.length !== 2) throw new Error("更新清单必须同时声明本版本的 DMG 和 ZIP");

  for (const name of [dmg, zip]) {
    const entry = manifest.files.find(({ url }) => url === name);
    if (!entry) throw new Error(`更新清单未声明 ${name}`);
    const artifactPath = NodePath.join(directory, name);
    if (
      (await NodeFSP.stat(artifactPath)).size !== entry.size ||
      (await hashFile(artifactPath, "sha512")).digest("base64") !== entry.sha512
    ) {
      throw new Error(`更新清单中的大小或 SHA-512 与文件不一致：${name}`);
    }
    if ((await NodeFSP.stat(`${artifactPath}.blockmap`)).size === 0) {
      throw new Error(`差分索引为空：${name}.blockmap`);
    }
  }
  return [manifestName, dmg, `${dmg}.blockmap`, zip, `${zip}.blockmap`];
}

function run(command: string, args: ReadonlyArray<string>, env = process.env) {
  NodeChildProcess.execFileSync(command, args, { stdio: "inherit", env });
}

function output(command: string, args: ReadonlyArray<string>) {
  return NodeChildProcess.execFileSync(command, args, { encoding: "utf8" }).trim();
}

async function verifyApp(bundle: string, version: string, team: string) {
  const plist = NodePath.join(bundle, "Contents/Info.plist");
  const bundleVersion = output("/usr/libexec/PlistBuddy", [
    "-c",
    "Print :CFBundleShortVersionString",
    plist,
  ]);
  const executable = output("/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleExecutable", plist]);
  const arches = output("lipo", ["-archs", NodePath.join(bundle, "Contents/MacOS", executable)]);
  if (bundleVersion !== version || arches !== "arm64") {
    throw new Error(`应用版本或架构不符：${bundleVersion} (${arches})`);
  }
  run("codesign", [
    "--verify",
    "--deep",
    "--strict",
    "-R",
    `=anchor apple generic and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = "${team}"`,
    bundle,
  ]);
  run("xcrun", ["stapler", "validate", bundle]);
  const feed = await NodeFSP.readFile(
    NodePath.join(bundle, "Contents/Resources/app-update.yml"),
    "utf8",
  );
  const yamlValue = (key: string) =>
    feed
      .split(/\r?\n/u)
      .find((line) => line.startsWith(`${key}:`))
      ?.slice(key.length + 1)
      .trim();
  if (
    yamlValue("provider") !== "github" ||
    `${yamlValue("owner")}/${yamlValue("repo")}` !== repository ||
    (yamlValue("channel") ?? "latest") !== "latest"
  ) {
    throw new Error("应用内更新源必须指向 cxdywhb/t3code 的稳定通道");
  }
  const signature = NodeChildProcess.spawnSync("codesign", ["-dv", "--verbose=4", bundle], {
    encoding: "utf8",
  });
  const codeHash = /^CDHash=([a-f0-9]+)$/mu.exec(signature.stderr)?.[1];
  if (signature.status !== 0 || !codeHash) throw new Error("无法读取应用签名摘要");
  return codeHash;
}

async function verifyPackages(directory: string, version: string, team: string) {
  const { dmg, zip } = macArtifacts(version);
  const temporary = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "xcode-mac-release-"));
  const mount = NodePath.join(temporary, "mounted");
  const installation = NodePath.join(temporary, "zip");
  try {
    run("ditto", ["-x", "-k", NodePath.join(directory, zip), installation]);
    const updateHash = await verifyApp(NodePath.join(installation, "X Code.app"), version, team);
    run("hdiutil", ["verify", NodePath.join(directory, dmg)]);
    await NodeFSP.mkdir(mount);
    run("hdiutil", [
      "attach",
      "-readonly",
      "-nobrowse",
      "-mountpoint",
      mount,
      NodePath.join(directory, dmg),
    ]);
    try {
      const installerHash = await verifyApp(NodePath.join(mount, "X Code.app"), version, team);
      if (installerHash !== updateHash) {
        throw new Error("DMG 与 ZIP 的应用签名摘要不一致");
      }
    } finally {
      run("hdiutil", ["detach", mount]);
    }
  } finally {
    await NodeFSP.rm(installation, { recursive: true, force: true });
    // An unsuccessful detach must never cause recursive deletion of a mounted volume.
    await NodeFSP.rmdir(mount).catch(() => undefined);
    await NodeFSP.rmdir(temporary).catch(() => undefined);
  }
}

async function publishRelease(
  tag: string,
  commit: string,
  notes: string,
  files: ReadonlyArray<string>,
) {
  run("gh", [
    "release",
    "create",
    tag,
    ...files,
    "--repo",
    repository,
    "--target",
    commit,
    "--title",
    `X Code ${tag}`,
    "--notes-file",
    notes,
    "--draft",
  ]);
  const release: {
    readonly isDraft: boolean;
    readonly targetCommitish: string;
    readonly assets: ReadonlyArray<{ readonly name: string; readonly digest: string }>;
  } = JSON.parse(
    output("gh", [
      "release",
      "view",
      tag,
      "--repo",
      repository,
      "--json",
      "isDraft,targetCommitish,assets",
    ]),
  );
  if (
    !release.isDraft ||
    release.targetCommitish !== commit ||
    release.assets.length !== files.length
  ) {
    throw new Error("GitHub 草稿的提交或附件数量与本次构建不一致");
  }
  for (const file of files) {
    const uploaded = release.assets.find(({ name }) => name === NodePath.basename(file));
    if (uploaded?.digest !== `sha256:${(await hashFile(file, "sha256")).digest("hex")}`) {
      throw new Error(`GitHub 草稿附件校验失败：${NodePath.basename(file)}`);
    }
  }
  run("gh", ["release", "edit", tag, "--repo", repository, "--draft=false", "--latest"]);
}

async function main() {
  const { values, positionals } = NodeUtil.parseArgs({
    allowPositionals: true,
    options: {
      publish: { type: "boolean" },
      notes: { type: "string" },
      verify: { type: "string" },
    },
  });
  const [version] = positionals;
  if (
    positionals.length !== 1 ||
    !version ||
    !/^\d+\.\d+\.\d+$/u.test(version) ||
    (values.publish && (!values.notes || values.verify))
  ) {
    throw new Error(
      "用法：vp exec node scripts/release-xcode-mac.ts <版本> [--publish --notes <文件> | --verify <产物目录>]",
    );
  }
  // oxlint-disable-next-line t3code/no-global-process-runtime -- Standalone packager checks the actual host architecture.
  if (NodeOS.platform() !== "darwin" || NodeOS.arch() !== "arm64") {
    throw new Error("请在 Apple Silicon Mac 上运行此发布命令");
  }
  const team = process.env.XCODE_RELEASE_TEAM_ID ?? "";
  if (!/^[A-Z0-9]{10}$/u.test(team)) {
    throw new Error("请设置 XCODE_RELEASE_TEAM_ID 为 X Code 获授权的签名 Team ID");
  }
  if (!values.verify && !process.env.CSC_NAME && !process.env.CSC_LINK) {
    throw new Error("请通过 CSC_NAME 或 CSC_LINK 显式选择 X Code 的 Developer ID Application 签名");
  }
  if (values.publish && output("git", ["status", "--porcelain"])) {
    throw new Error("请先提交工作区的修改");
  }
  const commit = output("git", ["rev-parse", "HEAD"]);
  const tag = `v${version}`;
  if (values.publish) {
    const branch = output("git", [
      "ls-remote",
      `https://github.com/${repository}.git`,
      "refs/heads/cxdy-dev",
    ]);
    if (branch.split(/\s/u)[0] !== commit) throw new Error("请先将本次提交推送至 cxdy-dev");
    const latest = output("gh", [
      "api",
      `repos/${repository}/releases/latest`,
      "--jq",
      ".tag_name",
    ]);
    if (compareSemverVersions(version, latest.replace(/^v/u, "")) <= 0) {
      throw new Error(`发布版本必须高于当前稳定版 ${latest}`);
    }
    await NodeFSP.stat(NodePath.resolve(values.notes!));
  }
  if (!values.verify) await NodeFSP.mkdir("release", { recursive: true });
  const directory = values.verify
    ? NodePath.resolve(values.verify)
    : await NodeFSP.mkdtemp(NodePath.resolve("release", `xcode-${tag}-`));
  if (!values.verify) {
    console.log(`构建产物目录：${directory}`);
    run(
      "vp",
      [
        "run",
        "dist:desktop:dmg:arm64",
        "--signed",
        "--build-version",
        version,
        "--output-dir",
        directory,
      ],
      {
        ...process.env,
        T3CODE_DESKTOP_UPDATE_REPOSITORY: repository,
        T3CODE_DESKTOP_MOCK_UPDATES: "false",
      },
    );
    if (
      output("git", ["rev-parse", "HEAD"]) !== commit ||
      (values.publish && output("git", ["status", "--porcelain"]))
    ) {
      throw new Error("构建期间工作区发生变化，产物不能用于发布");
    }
  }
  const files = await verifyMacUpdateAssets(directory, version);
  await verifyPackages(directory, version, team);
  const sums = await Promise.all(
    files.map(
      async (name) =>
        `${(await hashFile(NodePath.join(directory, name), "sha256")).digest("hex")}  ${name}\n`,
    ),
  );
  await NodeFSP.writeFile(NodePath.join(directory, sumsName), sums.join(""));
  if (values.publish) {
    await publishRelease(
      tag,
      commit,
      NodePath.resolve(values.notes!),
      [...files, sumsName].map((name) => NodePath.join(directory, name)),
    );
  }
  console.log(`已校验全部产物：${directory}`);
}

if (import.meta.main) {
  await main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
