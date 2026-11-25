"""从 t3 workflow show --json 导出可在 Git 仓库直接阅读的中文运行档案。"""

import json
import sys

ROLES = {
    "prd": "唐僧 · 产品",
    "analysis": "沙僧 · 研发分析",
    "requirements-review": "观音 · 需求评审",
    "design": "孙悟空 · 技术方案",
    "design-review": "太上老君 · 技术评审",
    "qa": "猪八戒 · 测试",
}


def report(record):
    run = record["run"]
    if run["workflow"] != "pilgrimage-rd" or run["status"] != "completed":
        raise ValueError("请选择已完成的 pilgrimage-rd 运行")
    stages = [s for s in record["steps"] if s["kind"] == "agent"]
    archive = next(s for s in record["steps"] if s["name"] == "archive")
    if archive["status"] != "completed" or archive["result"] != run["result"]:
        raise ValueError("归档步骤与最终产物不一致")
    lines = [
        "# 取经队补给申请 · 实际运行档案",
        "",
        f"运行编号 `{run['runId']}`。工作流版本 {run['version']}。以下时间均为 UTC。",
        "",
        f"开始于 {run['startedAt']}，完成于 {run['endedAt']}。",
        "",
        "| 次序 | 角色 | 步骤 | 交付或结论 |",
        "| --- | --- | --- | --- |",
    ]
    details = []
    latest = {}
    for index, step in enumerate(stages, 1):
        name = step["name"]
        role, version = name.rsplit("-", 1)
        result = step["result"]
        if step["status"] != "completed" or not result["markdown"].strip():
            raise ValueError(f"阶段缺少交付物 {name}")
        latest[role] = result
        heading = result.get("decision") or result["title"]
        lines.append(
            f"| {index} | {ROLES[role]} | {name} | {heading.replace('|', '／')} |"
        )
        details.extend(
            [
                "",
                f"## {index}. {ROLES[role]} · 第 {version} 轮",
                "",
                f"{step['startedAt']} 至 {step['endedAt']}。{heading}",
                "",
                result["markdown"].strip(),
            ]
        )
    for role, key in {
        "prd": "prd",
        "analysis": "analysis",
        "requirements-review": "requirementsReview",
        "design": "design",
        "design-review": "designReview",
        "qa": "tests",
    }.items():
        if latest[role] != archive["result"][key]:
            raise ValueError(f"归档引用了错误版本 {role}")
    if any(
        latest[r]["decision"] != "通过"
        for r in ("requirements-review", "design-review")
    ):
        raise ValueError("存在未通过的评审")
    return "\n".join(
        lines
        + details
        + [
            "",
            "## 归档",
            "",
            "已核对归档中的 PRD、研发分析、两份评审结论、技术方案及测试用例，均与对应角色的最后一次交付一致。",
            "",
        ]
    )


if __name__ == "__main__":
    print(report(json.load(sys.stdin)), end="")
