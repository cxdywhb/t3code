import { CollaborationDeliverables, CollaborationTemplate, ProjectId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { step, stop, tags, title, workflow } from "./workflow.ts";
import { agent } from "./workflowAgent.ts";

const submission = Schema.Struct({
  decision: Schema.Literals(["完成", "退回"]),
  markdown: Schema.NonEmptyString.check(Schema.isMaxLength(16000)),
});
const input = Schema.Struct({
  template: CollaborationTemplate,
  project: ProjectId,
  title: Schema.NonEmptyString,
  description: Schema.NonEmptyString,
});

export const collaborationWorkflow = workflow(
  "team-collaboration",
  { version: 1, payload: input, returns: CollaborationDeliverables },
  Effect.fn(function* (requirement) {
    const { project, template, description } = requirement;
    yield* title(requirement.title);
    yield* tags([`template:${template.id}`]);
    yield* step("需求", { returns: input }, Effect.succeed(requirement));
    const outputs: Array<(typeof CollaborationDeliverables.Type)[number]> = [];
    const authors: Array<{ readonly threadId: string }> = [];
    for (const [index, stage] of template.stages.entries()) {
      const name = `${index + 1} · ${stage.role}`;
      const brief = () =>
        [
          `你是${stage.role}。${stage.instruction}`,
          "根据本次需求与上游交付提交 Markdown。能完成本阶段时选择完成。仅当上游存在阻塞交付的具体问题时选择退回并说明原因。",
          JSON.stringify({ title: requirement.title, description, upstream: outputs }),
        ].join("\n");
      let result = yield* agent(name, {
        project,
        title: name,
        brief: brief(),
        returns: submission,
        timeout: "10 minutes",
      });
      if (result.value.decision === "退回") {
        const author = authors[index - 1];
        const previous = outputs[index - 1];
        if (author === undefined || previous === undefined)
          return yield* stop(result.value.markdown);
        const amendment = yield* agent(`${name} · 上游修订`, {
          thread: author,
          brief: `修订你的完整交付并提交。评审意见：\n${result.value.markdown}`,
          returns: submission,
          timeout: "10 minutes",
        });
        if (amendment.value.decision === "退回") return yield* stop(amendment.value.markdown);
        outputs[index - 1] = { role: previous.role, markdown: amendment.value.markdown };
        result = yield* agent(`${name} · 复审`, {
          thread: result.thread,
          brief: brief(),
          returns: submission,
          timeout: "10 minutes",
        });
        if (result.value.decision === "退回") return yield* stop(result.value.markdown);
      }
      authors.push(result.thread);
      outputs.push({ role: stage.role, markdown: result.value.markdown });
    }
    return outputs;
  }),
);
