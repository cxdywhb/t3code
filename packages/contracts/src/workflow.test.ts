import { describe, expect, it } from "@effect/vitest";
import * as Schema from "effect/Schema";

import {
  CollaborationTemplate,
  StartCollaborationRequirementInput,
  StartCollaborationRequirementResult,
  WorkflowRunsSubscribeInput,
  WorkflowRunsUpdate,
} from "./workflow.ts";

const decodeTemplate = Schema.decodeUnknownSync(CollaborationTemplate);
const decodeRequirement = Schema.decodeSync(StartCollaborationRequirementInput);
const decodeRequirementResult = Schema.decodeSync(StartCollaborationRequirementResult);

const decodeUpdate = Schema.decodeUnknownSync(WorkflowRunsUpdate);
const encodeInput = Schema.encodeSync(WorkflowRunsSubscribeInput);
// The input of a server from before `changes`.
const decodeOlderInput = Schema.decodeUnknownSync(Schema.Struct({}));

describe("workflows.subscribe across versions", () => {
  it("reads a whole list from a server that does not send changes", () => {
    const list = { workflows: [], runs: [], questions: [] };
    expect(decodeUpdate(list)).toEqual(list);
  });

  it("asks for changes in a way an older server ignores", () => {
    expect(() => decodeOlderInput(encodeInput({ changes: true }))).not.toThrow();
  });
});

describe("协作模板输入边界", () => {
  const template = {
    id: "c0547239-a388-4d20-85cc-b2a84c7dd024",
    name: "研发协作",
    stages: [{ role: "开发", instruction: "实现需求" }],
  };

  it("接受有效模板并保留现有项目和运行 ID 格式", () => {
    expect(decodeTemplate(template)).toEqual(template);
    expect(
      decodeRequirement({
        templateId: template.id,
        projectId: "existing-project",
        title: "需求",
        description: "需求描述",
        key: "request-1",
      }).projectId,
    ).toBe("existing-project");
    const runId = "a".repeat(32);
    expect(decodeRequirementResult({ runId })).toEqual({ runId });
  });

  it.each([
    { id: "invalid" },
    { name: "   " },
    { name: "a".repeat(121) },
    { stages: [] },
    { stages: Array.from({ length: 13 }, () => template.stages[0]) },
    { stages: [{ role: " ", instruction: "实现需求" }] },
    { stages: [{ role: "a".repeat(81), instruction: "实现需求" }] },
    { stages: [{ role: "开发", instruction: " " }] },
    { stages: [{ role: "开发", instruction: "a".repeat(20_001) }] },
  ])("拒绝非法模板字段", (invalid) => {
    expect(() => decodeTemplate({ ...template, ...invalid })).toThrow();
  });

  it.each([
    { templateId: "invalid" },
    { projectId: " " },
    { title: " " },
    { title: "a".repeat(201) },
    { description: " " },
    { description: "a".repeat(50_001) },
    { key: " " },
    { key: "a".repeat(201) },
  ])("拒绝非法启动字段", (invalid) => {
    expect(() =>
      decodeRequirement({
        templateId: template.id,
        projectId: "existing-project",
        title: "需求",
        description: "需求描述",
        key: "request-1",
        ...invalid,
      }),
    ).toThrow();
  });
});
