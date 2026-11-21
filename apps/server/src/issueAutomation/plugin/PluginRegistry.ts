import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import {
  IssueAutomationError,
  IssueAutomationPlatformKind,
  type IssueAutomationPlatformDescriptor,
} from "@t3tools/contracts";

import { makeZenTaoPlatformPlugin } from "../connectors/zentao/ZenTaoPlatformPlugin.ts";
import type { IssuePlatformPlugin } from "./IssuePlatformPlugin.ts";

const JIRA_RESERVED_DESCRIPTOR: IssueAutomationPlatformDescriptor = {
  platform: IssueAutomationPlatformKind.make("jira"),
  displayName: "Jira Software (扩展插槽)",
  description: "预留可插拔 Jira Cloud / Data Center 适配器接口，无需改动诊断引擎即可扩展接入",
  implemented: false,
  scopeNoun: "项目",
  issueNoun: "Issue",
  authFields: [
    {
      key: "baseUrl",
      label: "Jira 地址",
      placeholder: "https://jira.example.com",
      kind: "url",
      required: true,
    },
    {
      key: "account",
      label: "账号 / 邮箱",
      placeholder: "user@example.com",
      kind: "text",
      required: true,
    },
    {
      key: "secret",
      label: "API Token / PAT",
      placeholder: "输入 Jira PAT 或密码",
      kind: "password",
      required: true,
    },
  ],
};

export class IssuePlatformPluginRegistry extends Context.Service<
  IssuePlatformPluginRegistry,
  {
    readonly descriptors: ReadonlyArray<IssueAutomationPlatformDescriptor>;
    readonly get: (kind: IssueAutomationPlatformKind) => IssuePlatformPlugin | null;
    readonly requirePlugin: (
      kind: IssueAutomationPlatformKind,
    ) => Effect.Effect<IssuePlatformPlugin, IssueAutomationError>;
  }
>()("t3/issueAutomation/plugin/PluginRegistry/IssuePlatformPluginRegistry") {}

function fromPlugins(
  plugins: ReadonlyArray<IssuePlatformPlugin>,
  reservedDescriptors: ReadonlyArray<IssueAutomationPlatformDescriptor> = [
    JIRA_RESERVED_DESCRIPTOR,
  ],
): IssuePlatformPluginRegistry["Service"] {
  const byKind = new Map(plugins.map((plugin) => [plugin.kind, plugin]));
  const descriptors = [
    ...plugins.map((plugin) => plugin.descriptor),
    ...reservedDescriptors.filter((descriptor) => !byKind.has(descriptor.platform)),
  ];

  return {
    descriptors,
    get: (kind) => byKind.get(kind) ?? null,
    requirePlugin: (kind) => {
      const plugin = byKind.get(kind);
      return plugin !== undefined
        ? Effect.succeed(plugin)
        : Effect.fail(
            new IssueAutomationError({
              operation: "resolvePlatformPlugin",
              detail: `平台插件 "${kind}" 尚未启用或未安装适配器`,
            }),
          );
    },
  };
}

export const layer = Layer.sync(IssuePlatformPluginRegistry, () =>
  fromPlugins([makeZenTaoPlatformPlugin()]),
);
