const { workflow, agent, title, stop, step } = T3;
const model = { instanceId: "codex_codex_pro_cli", model: "gpt-6.1-sol" };
const document = Schema.Struct({ title: Schema.String, markdown: Schema.NonEmptyString });
const assessment = Schema.Struct({
  decision: Schema.Literals(["通过", "退回"]),
  markdown: Schema.NonEmptyString,
});
const brief = (task, inputs) =>
  [
    task,
    "只用中文，尽量精简，但优先保证完整覆盖。直接提交结构化结果，不操作文件或外部系统。",
    JSON.stringify(inputs),
  ].join("\n");

workflow(
  "pilgrimage-rd",
  { version: 2, payload: Schema.Struct({ project: Schema.String }), concurrency: 1 },
  Effect.fn(function* ({ project }) {
    const subject = "取经队补给申请：队员填写物品名和正整数数量后提交，由粮草官查看。";
    yield* title("西游记 · 取经队补给申请");
    const job = (name, role, task, inputs, returns = document) =>
      agent(name, {
        project,
        model,
        title: role,
        brief: brief(task, inputs),
        returns,
        timeout: "5 minutes",
      });
    const revise = (name, author, task, inputs) =>
      agent(name, {
        thread: author.thread,
        brief: brief(task, inputs),
        returns: document,
        timeout: "5 minutes",
      });

    let prd = yield* job(
      "prd-1",
      "唐僧 · 产品",
      "按原始委托写最小 PRD，编号 AC-1 起。未明确的问题登记为待确认。",
      subject,
    );
    let analysis = yield* job(
      "analysis-1",
      "沙僧 · 研发分析",
      "分析可行性、边界、待裁决点。",
      prd.value,
    );
    const policy =
      "粮草官在评审时追加了硬性规则：同一队员同一自然日（北京时间）最多三笔，第四笔拒绝且不入账。定稿需明确此规则及可验证的验收编号。";
    const reviewPrd = (round, draft) =>
      job(
        "requirements-review-" + round,
        "观音 · 需求评审",
        "你是需求评审，本步骤只决定 PRD 是否明确原始委托与新增规则并给出可验证的 AC。分析是背景材料。实现细节交下一阶段，不作为阻塞项。只对缺少硬性需求作退回。",
        [draft, analysis.value, policy],
        assessment,
      );
    let review = yield* reviewPrd(1, prd.value);
    for (let round = 2; review.value.decision === "退回" && round <= 3; round++) {
      prd = yield* revise("prd-" + round, prd, "依据意见修订完整 PRD，保留验收编号。", [
        review.value,
        policy,
      ]);
      analysis = yield* revise(
        "analysis-" + round,
        analysis,
        "基于修订版 PRD 更新整份分析，覆盖新增业务规则，删除已裁决的待办。",
        [prd.value, policy, review.value],
      );
      review = yield* reviewPrd(round, prd.value);
    }
    if (review.value.decision !== "通过") return yield* stop("需求复审退回，请产品负责人裁决。");

    let design = yield* job(
      "design-1",
      "孙悟空 · 技术方案",
      "给出最小技术方案，覆盖验收编号，并说明限额并发控制和时区。",
      [prd.value, analysis.value],
    );
    const reviewDesign = (round, draft) =>
      job(
        "design-review-" + round,
        "太上老君 · 方案评审",
        "核对定稿 PRD。仅阻塞正确性或可测试性的问题退回。",
        [prd.value, draft],
        assessment,
      );
    let verdict = yield* reviewDesign(1, design.value);
    for (let round = 2; verdict.value.decision === "退回" && round <= 3; round++) {
      design = yield* revise("design-" + round, design, "修订并提交完整技术方案。", [
        verdict.value,
        prd.value,
      ]);
      verdict = yield* reviewDesign(round, design.value);
    }
    if (verdict.value.decision !== "通过") return yield* stop("技术复审退回，请技术负责人裁决。");
    const tests = yield* job(
      "qa-1",
      "猪八戒 · 测试",
      "按验收编号生成用例。给出输入、动作、预期，覆盖限额边界、并发及跨日。",
      [prd.value, design.value],
    );
    return yield* step(
      "archive",
      {
        returns: Schema.Struct({
          prd: document,
          analysis: document,
          design: document,
          tests: document,
          requirementsReview: assessment,
          designReview: assessment,
        }),
      },
      Effect.succeed({
        prd: prd.value,
        analysis: analysis.value,
        design: design.value,
        tests: tests.value,
        requirementsReview: review.value,
        designReview: verdict.value,
      }),
    );
  }),
);
