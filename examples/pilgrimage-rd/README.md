# 研发协作方案与取经队样例

[查看本次完整运行档案](./run.md)，或下载 [离线阅读页](./run.html) 后在浏览器打开。在另一台电脑上打开这份档案，即可阅读各角色的初稿、退回理由、修订稿、评审结论和测试用例。查看进行中的任务，需要连接发起该任务的 T3 环境。

## 目标与验收

以“取经队申请补给，粮草官查看”为唯一需求，用六个角色完成从 PRD 到测试设计的协作。样例刻意在需求评审时追加一条真实可检验的约束：按北京时间计算，同一队员每个自然日最多成功三笔申请，第四笔拒绝且不入账。评审者判断交付是否满足条件，流程按实际结论分支。补给应用本身属于后续开发工作。

验收要求如下。

1. 每位作者能拿到前一阶段产物，评审者独立开线程。退回时原作者收到意见并修订。
2. 研发协作页面实时显示运行情况，可以逐轮打开文档、评审结论和线程。已知阶段在开始前显示为待执行。
3. 只有两次评审的最终结论均为通过时，流程才生成用例并归档。最终产物与各角色最后交付的版本一致。
4. 换电脑仍能查看此次定稿，也能在具备相同 Provider 的服务器上重新发起运行。

## 流程与职责

| 阶段     | 执行者    | 必备输入                                 | 输出与流转                                                   |
| -------- | --------- | ---------------------------------------- | ------------------------------------------------------------ |
| 需求拆解 | 唐僧      | 原始委托                                 | PRD、带编号的验收条件、待确认问题                            |
| 研发分析 | 沙僧      | 当前 PRD                                 | 可行性、业务边界、待裁决点                                   |
| 需求评审 | 观音      | 当前 PRD、分析、新增规则                 | 通过后转方案。退回则唐僧改 PRD，沙僧同步分析，再开新线程复审 |
| 技术方案 | 孙悟空    | 已通过的 PRD 和配套分析                  | 技术方案，含限额并发控制和时区处理                           |
| 方案评审 | 太上老君  | 定稿 PRD、当前方案                       | 通过后转测试。退回则孙悟空在原线程修订，再独立复审           |
| 测试设计 | 猪八戒    | 已通过的方案和 PRD                       | 对应验收编号的输入、动作、预期结果                           |
| 归档     | T3 Server | 最终 PRD、分析、两次评审结论、方案、用例 | 写入运行结果，支持导出可携带的档案                           |

每类评审最多三轮。第三轮仍退回会以 stopped 状态结束并给出原因，避免无限消耗额度。Agent 超时或执行失败遵循 T3 的暂停和恢复语义。调度脚本只接受预先注册的 T3 项目，明确指定 Codex Pro 实例及 gpt-6.1-sol，没有账号回退。每次新建运行会消耗真实模型额度。

## 模块划分与部署

- **执行层**由本目录的 workflow.ts 提供。每项需求对应一次 durable run。角色间传递结构化文档或有枚举约束的评审结果。T3 在发起端持久化步骤、时间、重试、线程关联和结果。审批与返工历史可以重放查看。
- **展示层**位于 Web 的 Workflows 模块，桌面壳共用。打开 Workflows，再选“研发协作”。也可以访问 `/workflows?rd=true`。客户端复用环境配对、服务端读取权限、运行订阅和详情查询。原生 Workflows 可看完整时间线、查看线程、恢复或取消运行。手机浏览器可连接同一服务器；原生移动应用沿用通用工作流视图。
- **交付层**由 report.py 校验并导出运行档案。Git 保存样例定义、方案及本次结果，团队服务保存实时状态。团队需要对 T3 服务数据、Workflow 脚本以及项目工作区分别备份，并演练恢复。仅复制仓库可以查看已导出的文档。
- **协作提醒**由 notify.py 从指定运行快照中提取退回、异常停止及完成事件。默认在终端预览，也支持飞书群机器人与可选签名。团队部署时对关注的运行定时调用它并持久化投递台账。若要求分钟级提醒，可由独立任务每分钟调度。需要发现 Server 整机离线时，监控须部署到另一台主机。
- **正式团队部署**建议内网常驻 T3 Server、企业反向代理和 HTTPS，所有成员连接同一环境，给观察者签发仅含 orchestration:read 的凭据。飞书群提醒只带获准公开到群的内容。精确到个人的“等我处理”、企业身份登录、签核权限和飞书卡片回调属于下一阶段，需要补充身份绑定、服务端鉴权、防重放和审计记录。

首次试运行中，产品修订了 PRD，研发分析却仍引用旧版约束，导致需求复审退回。当前第 2 版工作流在 PRD 变更后也会唤回沙僧同步更新分析，从源头解决同一评审使用两版材料的问题。此前的停止记录保留在原环境。

## 在开发机复跑

从仓库根目录操作。需要 Node、Vite+、Python 3 和可用的 Codex Pro Provider。先按仓库开发指南安装依赖。示例使用独立的 T3 home。

```sh
export T3CODE_HOME="$PWD/.t3/pilgrimage"
export T3CODE_WORKFLOWS="$PWD/examples/pilgrimage-rd/workflow.ts"
T3CODE_DEV_INSTANCE=82 vp run dev --home-dir "$T3CODE_HOME" --no-seed
```

使用启动输出的 pairingUrl 完成配对。在此隔离环境的 Settings → Labs 启用 Workflows，并在 Providers 中配置已授权的 Pro 实例。样例实例 ID 为 `codex_codex_pro_cli`。如果本机的 Pro 实例 ID 不同，先核实账户，再调整 workflow.ts 中的 instanceId。服务所在主机必须能运行该 Provider 并访问模型。不要在仓库内保存账户配置或配对令牌。

另开终端，从相同仓库根目录运行以下命令。每个示例项目只需注册一次。同一需求键重复启动会返回同一次运行；需要进行新的试验时更换键。

```sh
export T3CODE_HOME="$PWD/.t3/pilgrimage"
node apps/server/src/bin.ts project add "$PWD/examples/pilgrimage-rd" --base-dir "$T3CODE_HOME"
node apps/server/src/bin.ts workflow start pilgrimage-rd --base-dir "$T3CODE_HOME" \
  --key supplies-demo-01 --input "{\"project\":\"$PWD/examples/pilgrimage-rd\"}"
```

打开启动日志中的 Web 地址，进入 `/workflows?rd=true`。点击运行标题选择需求，展开任一阶段，使用“打开线程”查看实际对话。要把某次运行发给已获授权的同事，可复制选中运行后的页面地址；部署地址必须是同事能访问的团队域名。若桌面客户端使用旧版，可从当前分支启动的 Web 端进入专用页面。

## 导出和提醒

将下面的 RUN_ID 换成启动命令返回的编号，TEAM_PAGE 换成对应部署的协作页面。快照文件可以放在忽略的开发状态目录。

```sh
RUN_ID='<运行编号>'
TEAM_PAGE="https://t3.example.com/workflows?rd=true&run=$RUN_ID"
snapshot="$T3CODE_HOME/run-$RUN_ID.json"
node apps/server/src/bin.ts workflow show "$RUN_ID" --base-dir "$T3CODE_HOME" --json > "$snapshot"
python3 examples/pilgrimage-rd/report.py < "$snapshot" > "$T3CODE_HOME/report-$RUN_ID.md"
python3 examples/pilgrimage-rd/notify.py --page "$TEAM_PAGE" < "$snapshot"
```

report.py 仅导出完成且通过一致性校验的运行。它检查归档与最终结果相等、两次评审均通过、六份最终交付与对应阶段的最后一版完全一致。导出后再将允许团队阅读的档案提交到私有仓库或知识库。

飞书群机器人发送需要由运维通过环境变量提供 FEISHU_BOT_WEBHOOK；启用签名时一并设置 FEISHU_BOT_SECRET。发送命令如下。

```sh
python3 examples/pilgrimage-rd/notify.py --page "$TEAM_PAGE" \
  --send --ledger "$T3CODE_HOME/feishu-team.sqlite" < "$snapshot"
```

台账按群单独保存，成功响应后记录运行与事件键，重复处理同一快照会跳过已发送事件。网络超时且飞书实际已收件时，下一次重试可能重复投递。本次样例使用本地预览与替身接收验证，真实群投递、企业身份与异机服务部署需在团队环境验收。[飞书自定义机器人配置](https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot)
