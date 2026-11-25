import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  ExecutionEnvironmentDescriptor,
  type RepositoryIdentity,
  resolveOriginOnlyRepositoryIdentity,
} from "./environment.ts";
import { SourceControlProviderKind } from "./sourceControl.ts";

const decodeDescriptor = Schema.decodeUnknownSync(ExecutionEnvironmentDescriptor);

const descriptor = {
  environmentId: "environment-1",
  label: "Local",
  platform: { os: "darwin", arch: "arm64" },
  serverVersion: "0.0.32",
  capabilities: { repositoryIdentity: true },
} as const;

describe("ExecutionEnvironmentDescriptor", () => {
  it("decodes old, recognized and future manual installation descriptors", () => {
    expect(decodeDescriptor(descriptor).capabilities.serverInstallation).toBeUndefined();
    for (const installation of [
      { kind: "npx" },
      { kind: "npm-global", prefix: "/opt/node" },
      { kind: "t3-launcher", launcher: "/opt/bin/t3", baseDir: "/data/t3" },
    ]) {
      expect(
        decodeDescriptor({
          ...descriptor,
          capabilities: { ...descriptor.capabilities, serverInstallation: installation },
        }).capabilities.serverInstallation,
      ).toEqual(installation);
    }
    const spaced = { kind: "t3-launcher", launcher: "/opt/bin/t3 ", baseDir: " /data/t3 " };
    expect(
      decodeDescriptor({
        ...descriptor,
        capabilities: { ...descriptor.capabilities, serverInstallation: spaced },
      }).capabilities.serverInstallation,
    ).toEqual(spaced);
    for (const installation of [
      { kind: "future-manager" },
      { kind: "npm-global" },
      { kind: "t3-launcher", launcher: "t3" },
    ]) {
      expect(
        decodeDescriptor({
          ...descriptor,
          capabilities: { ...descriptor.capabilities, serverInstallation: installation },
        }).capabilities.serverInstallation,
      ).toBeUndefined();
    }
  });
});

describe("resolveOriginOnlyRepositoryIdentity", () => {
  const forkIdentity: RepositoryIdentity = {
    canonicalKey: "github.com/upstream-org/repo",
    locator: {
      source: "git-remote",
      remoteName: "upstream",
      remoteUrl: "https://github.com/upstream-org/repo.git",
    },
    webUrl: "https://github.com/upstream-org/repo",
    rootPath: "/workspaces/repo",
    displayName: "upstream-org/repo",
    provider: SourceControlProviderKind.make("github"),
    owner: "upstream-org",
    name: "repo",
    origin: {
      canonicalKey: "github.com/alice/repo",
      remoteUrl: "git@github.com:alice/repo.git",
      displayName: "alice/repo",
    },
  };

  it("handles missing identities and disabled mode", () => {
    expect(resolveOriginOnlyRepositoryIdentity(null, true)).toBeNull();
    expect(resolveOriginOnlyRepositoryIdentity(undefined, true)).toBeNull();
    expect(resolveOriginOnlyRepositoryIdentity(forkIdentity, false)).toBe(forkIdentity);
  });

  it("rewrites a fork identity to its origin remote and strips upstream metadata", () => {
    const resolved = resolveOriginOnlyRepositoryIdentity(forkIdentity, true, {
      recognizeProvider: (url) =>
        url.includes("github.com") ? SourceControlProviderKind.make("github") : undefined,
    });
    expect(resolved).toEqual({
      canonicalKey: "github.com/alice/repo",
      locator: {
        source: "git-remote",
        remoteName: "origin",
        remoteUrl: "git@github.com:alice/repo.git",
      },
      rootPath: "/workspaces/repo",
      displayName: "alice/repo",
      provider: SourceControlProviderKind.make("github"),
      owner: "alice",
      name: "repo",
    });
  });

  it("switches provider when origin is on a different forge and keeps same-host SSH providers", () => {
    const crossForge = resolveOriginOnlyRepositoryIdentity(
      {
        ...forkIdentity,
        origin: {
          canonicalKey: "gitlab.com/alice/repo",
          remoteUrl: "https://gitlab.com/alice/repo.git",
        },
      },
      true,
      {
        recognizeProvider: (url) =>
          url.includes("gitlab.com") ? SourceControlProviderKind.make("gitlab") : undefined,
      },
    );
    expect(crossForge?.provider).toBe("gitlab");
    expect(crossForge?.displayName).toBe("alice/repo");

    const selfHosted = resolveOriginOnlyRepositoryIdentity(
      {
        canonicalKey: "git.corp.test/upstream/repo",
        locator: {
          source: "git-remote",
          remoteName: "upstream",
          remoteUrl: "git@corp-ssh:upstream/repo.git",
        },
        provider: SourceControlProviderKind.make("gitlab"),
        origin: {
          canonicalKey: "git.corp.test/alice/repo",
          remoteUrl: "git@corp-ssh:alice/repo.git",
          displayName: "alice/repo",
        },
      },
      true,
      {
        recognizeProvider: () => SourceControlProviderKind.make("unknown"),
      },
    );
    expect(selfHosted?.provider).toBe("gitlab");
  });

  it("keeps origin-only identities and drops upstream-only checkouts without origin", () => {
    const originOnlyCheckout: RepositoryIdentity = {
      canonicalKey: "github.com/alice/solo",
      locator: {
        source: "git-remote",
        remoteName: "origin",
        remoteUrl: "https://github.com/alice/solo.git",
      },
      provider: SourceControlProviderKind.make("github"),
      displayName: "alice/solo",
    };
    expect(resolveOriginOnlyRepositoryIdentity(originOnlyCheckout, true)).toBe(originOnlyCheckout);

    const upstreamOnlyCheckout: RepositoryIdentity = {
      canonicalKey: "github.com/upstream-org/only",
      locator: {
        source: "git-remote",
        remoteName: "upstream",
        remoteUrl: "https://github.com/upstream-org/only.git",
      },
      provider: SourceControlProviderKind.make("github"),
      displayName: "upstream-org/only",
    };
    expect(resolveOriginOnlyRepositoryIdentity(upstreamOnlyCheckout, true)).toBeNull();
  });
});
