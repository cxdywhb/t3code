import {
  IssueAutomationPlatformKind,
  type IssueAutomationPlatformDescriptor,
} from "@t3tools/contracts";

import type { IssuePlatformPlugin } from "../../plugin/IssuePlatformPlugin.ts";
import { normalizeZenTaoBaseUrl, ZenTaoSessionClient } from "./ZenTaoClient.ts";

const ZENTAO_PLATFORM_KIND = IssueAutomationPlatformKind.make("zentao");

const ZENTAO_DESCRIPTOR: IssueAutomationPlatformDescriptor = {
  platform: ZENTAO_PLATFORM_KIND,
  displayName: "禅道 (ZenTao)",
  description: "企业内网禅道项目管理平台，支持产品/Bug 拉取、截图解析、评论写入与状态流转",
  implemented: true,
  scopeNoun: "产品",
  issueNoun: "Bug",
  authFields: [
    {
      key: "baseUrl",
      label: "禅道地址",
      placeholder: "https://zentao.company.com/zentao",
      kind: "url",
      required: true,
    },
    {
      key: "account",
      label: "登录账号",
      placeholder: "输入禅道用户名",
      kind: "text",
      required: true,
    },
    {
      key: "secret",
      label: "登录密码",
      placeholder: "输入禅道登录密码（加密存储）",
      kind: "password",
      required: true,
    },
  ],
};

export function makeZenTaoPlatformPlugin(): IssuePlatformPlugin {
  const client = new ZenTaoSessionClient();
  return {
    kind: ZENTAO_PLATFORM_KIND,
    descriptor: ZENTAO_DESCRIPTOR,
    normalizeBaseUrl: normalizeZenTaoBaseUrl,
    probeAndListScopes: client.probeAndListScopes,
    listIssues: client.listIssues,
    getIssueDetail: client.getIssueDetail,
    downloadAttachment: client.downloadAttachment,
    writeBack: client.writeBack,
  };
}
