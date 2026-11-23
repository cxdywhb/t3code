## 总体裁决结论

**要求修改（request-changes）。** PR #1 的归档提交 `355b21fff1f8` 涉及 37 个文件，+2203/−341。确认 1 项阻断、5 项重大和 4 项次要问题。凭据可能发往未经批准的地址，写工具审批可能跨会话生效，禅道写回还可能重复执行或落到另一实例。

## 多模型共识对比

- 两个模型共同命中凭据目的地、会话授权隔离和移动端迟到确认。凭据问题定为阻断。跨会话授权定为重大，服务端仍检查目标工具能否被 App 调用，失效的是用户对写操作的确认边界。
- 剔除 Android 原生三按钮槽位错配的归因。项目自有 Dialog 按顺序渲染动作并绑定各自回调。弹窗被替换会触发 onDismiss，这部分成立。
- 附件下载误收登录页、完整参数序列化在基线已存在。Web 全屏可退出后重置，关闭后可重新打开。重置覆盖挂起弹窗、全屏入口位置和重复元数据查询可另行改善，现有证据不足以将它们定为授权绕过。
- 两个模型均指出 PR 混入时间线对齐调整。请确认布局意图或移出独立提交。未使用的 normalizeBaseUrl 接口可单独清理。

## 核心问题汇总

| 级别    | 问题与位置                                                                                                                                                                          | 影响                                                                                                                                         | 修改建议                                                                                                     |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| blocker | 禅道登录会采用未经确认的重定向地址 [ZenTaoClient.ts:553](/Users/wanghaobing/Desktop/Workspace/React/t3code/apps/server/src/issueAutomation/connectors/zentao/ZenTaoClient.ts:553)   | 配置探测自动跟随 HTTP 重定向，并将最终响应地址用作登录根地址。发生跨主机跳转或 HTTPS 降级时，账号和密码可能发往用户未批准的目的地。          | 在发出每一跳请求前校验主机、端口和协议。探测与携带凭据的请求共用该策略，仅放行明确允许的同站跳转和安全升级。 |
| major   | 同名 MCP 工具跨会话继承授权 [toolApproval.ts:71](/Users/wanghaobing/Desktop/Workspace/React/t3code/packages/client-runtime/src/mcpApps/toolApproval.ts:71)                          | 客户端只按环境、服务器名和工具名记忆决定，服务端却按实际 provider 会话解析工具。另一会话的同名可调用写工具可复用旧授权。                     | 按实际会话和 MCP 连接身份隔离授权、静默、待决请求及重置范围，连接替换时失效。                                |
| major   | 移动端弹窗失效后仍能改变授权 [McpAppWebView.tsx:378](/Users/wanghaobing/Desktop/Workspace/React/t3code/apps/mobile/src/features/threads/McpAppWebView.tsx:378)                      | 页面只在打开弹窗前检查是否已卸载，迟到确认仍可记录授权并触发调用。Android 弹窗被替换也会触发 onDismiss，被记录为主动拒绝并静默后续后台请求。 | 卸载或替换时取消待决请求，把无答复与主动拒绝分开；写入授权和发送调用前复核页面仍有效。                       |
| major   | 禅道可能重发已成功的写请求 [ZenTaoClient.ts:799](/Users/wanghaobing/Desktop/Workspace/React/t3code/apps/server/src/issueAutomation/connectors/zentao/ZenTaoClient.ts:799)           | 任意非 JSON 正文只要含 user-login 就能触发重登并重发原请求。若建单或评论已经成功，响应页中的普通登录链接即可导致重复写入。                   | 解析实际登录跳转。只有能确认首次写入未执行或有幂等保障时才自动重发，否则返回结果待确认。                     |
| major   | 已保存的禅道连接可能切换到另一实例 [ZenTaoClient.ts:662](/Users/wanghaobing/Desktop/Workspace/React/t3code/apps/server/src/issueAutomation/connectors/zentao/ZenTaoClient.ts:662)   | 会话缓存失效后，常规读写也重新搜索其他子路径。原路径故障时，同域另一套可用且接受相同凭据的禅道可能接收后续写回。                             | 只在连接配置阶段发现入口。业务重登固定使用已保存的根地址，原实例不可用时报告失败。                           |
| major   | 禅道查询参数式登录跳转无法恢复 [ZenTaoClient.ts:799](/Users/wanghaobing/Desktop/Workspace/React/t3code/apps/server/src/issueAutomation/connectors/zentao/ZenTaoClient.ts:799)       | 过期检测只识别 user-login。使用 GET 路由的部署返回 m=user 与 f=login 时，HTML 跳转会报解析错误，JSON locate 也可能被当成业务结果。           | 统一解析最终 URL、HTML 跳转目标和 JSON locate，覆盖两种路由；重登后仍指向登录页应明确报错。                  |
| minor   | 第二种协议的禅道探测可能被提前截断 [ZenTaoClient.ts:524](/Users/wanghaobing/Desktop/Workspace/React/t3code/apps/server/src/issueAutomation/connectors/zentao/ZenTaoClient.ts:524)   | 裸主机的两套协议按顺序共用十次预算。首轮的多个 404 和根页面探测会挤掉第二轮靠后的候选路径。                                                  | 给备用协议保留预算，或在总上限内交错探测两个协议。                                                           |
| minor   | 移动全屏上报的可用高度包含权限栏 [McpAppWebView.tsx:699](/Users/wanghaobing/Desktop/Workspace/React/t3code/apps/mobile/src/features/threads/McpAppWebView.tsx:699)                  | 权限栏与 WebView 分占全屏高度，宿主仍把外层高度发给应用。按该值布局的内容可能超出可视区域。                                                  | 测量 WebView 容器的实际高度，权限栏出现或消失时更新宿主上下文。                                              |
| minor   | 新建连接后刷新了旧连接的查询 [IssueAutomationPage.tsx:1760](/Users/wanghaobing/Desktop/Workspace/React/t3code/apps/web/src/components/issueAutomation/IssueAutomationPage.tsx:1760) | 新建后切换连接的同一回调仍刷新本次渲染绑定的列表和详情，可能向旧连接发出多余请求。                                                           | 新建时由选择变化加载新连接，仅在编辑当前连接时手动刷新。                                                     |
| minor   | 八种语言的编辑连接入口仍显示英文 [de.json:6155](/Users/wanghaobing/Desktop/Workspace/React/t3code/apps/web/src/i18n/translations/de.json:6155)                                      | 德、西、法、日、韩、巴西葡语、俄、瑞典语的新增文案均为 Edit connection。                                                                     | 补齐该键的八种译文并检查界面显示。                                                                           |

## 合并前检查建议

1. 用隔离的禅道测试替身验证允许的同站升级、被拒绝的地址变更、原实例不可用时的写回目的地。分别对两种登录路由和含普通登录链接的成功响应断言建单与评论的写入次数。
2. Web、Desktop 和 Mobile 逐一检查同环境两条会话中的同名写工具，并覆盖移动端弹窗被替换、页面卸载和主动拒绝三种结果。
3. 本次重跑已有测试，共 26 项通过，含 4 项 Web 浏览器用例。Android Dialog 套件在收集阶段因 Vite 无法打包 `node:sea` 未执行，单独重跑结果相同。`git diff --check` 通过。未连接真实禅道或进行桌面端、移动端整体验收。

```json:t3-pr-fusion
{
  "verdict": "request-changes",
  "findings": [
    {
      "severity": "blocker",
      "title": "禅道登录会采用未经确认的重定向地址",
      "filePath": "apps/server/src/issueAutomation/connectors/zentao/ZenTaoClient.ts",
      "line": 553,
      "description": "配置探测自动跟随 HTTP 重定向，并将最终响应地址用作登录根地址。发生跨主机跳转或 HTTPS 降级时，账号和密码可能发往用户未批准的目的地。",
      "suggestion": "在发出每一跳请求前校验主机、端口和协议。探测与携带凭据的请求共用该策略，仅放行明确允许的同站跳转和安全升级。",
      "raisedByModels": [
        "antigravity:gemini-4-carbon",
        "codex:gpt-6.2-sol"
      ]
    },
    {
      "severity": "major",
      "title": "同名 MCP 工具跨会话继承授权",
      "filePath": "packages/client-runtime/src/mcpApps/toolApproval.ts",
      "line": 71,
      "description": "客户端只按环境、服务器名和工具名记忆决定，服务端却按实际 provider 会话解析工具。另一会话的同名可调用写工具可复用旧授权。",
      "suggestion": "按实际会话和 MCP 连接身份隔离授权、静默、待决请求及重置范围，连接替换时失效。",
      "raisedByModels": [
        "antigravity:gemini-4-carbon",
        "codex:gpt-6.2-sol"
      ]
    },
    {
      "severity": "major",
      "title": "移动端弹窗失效后仍能改变授权",
      "filePath": "apps/mobile/src/features/threads/McpAppWebView.tsx",
      "line": 378,
      "description": "页面只在打开弹窗前检查是否已卸载，迟到确认仍可记录授权并触发调用。Android 弹窗被替换也会触发 onDismiss，被记录为主动拒绝并静默后续后台请求。",
      "suggestion": "卸载或替换时取消待决请求，把无答复与主动拒绝分开；写入授权和发送调用前复核页面仍有效。",
      "raisedByModels": [
        "antigravity:gemini-4-carbon",
        "codex:gpt-6.2-sol"
      ]
    },
    {
      "severity": "major",
      "title": "禅道可能重发已成功的写请求",
      "filePath": "apps/server/src/issueAutomation/connectors/zentao/ZenTaoClient.ts",
      "line": 799,
      "description": "任意非 JSON 正文只要含 user-login 就能触发重登并重发原请求。若建单或评论已经成功，响应页中的普通登录链接即可导致重复写入。",
      "suggestion": "解析实际登录跳转。只有能确认首次写入未执行或有幂等保障时才自动重发，否则返回结果待确认。",
      "raisedByModels": [
        "codex:gpt-6.2-sol"
      ]
    },
    {
      "severity": "major",
      "title": "已保存的禅道连接可能切换到另一实例",
      "filePath": "apps/server/src/issueAutomation/connectors/zentao/ZenTaoClient.ts",
      "line": 662,
      "description": "会话缓存失效后，常规读写也重新搜索其他子路径。原路径故障时，同域另一套可用且接受相同凭据的禅道可能接收后续写回。",
      "suggestion": "只在连接配置阶段发现入口。业务重登固定使用已保存的根地址，原实例不可用时报告失败。",
      "raisedByModels": [
        "antigravity:gemini-4-carbon"
      ]
    },
    {
      "severity": "major",
      "title": "禅道查询参数式登录跳转无法恢复",
      "filePath": "apps/server/src/issueAutomation/connectors/zentao/ZenTaoClient.ts",
      "line": 799,
      "description": "过期检测只识别 user-login。使用 GET 路由的部署返回 m=user 与 f=login 时，HTML 跳转会报解析错误，JSON locate 也可能被当成业务结果。",
      "suggestion": "统一解析最终 URL、HTML 跳转目标和 JSON locate，覆盖两种路由；重登后仍指向登录页应明确报错。",
      "raisedByModels": [
        "antigravity:gemini-4-carbon"
      ]
    },
    {
      "severity": "minor",
      "title": "第二种协议的禅道探测可能被提前截断",
      "filePath": "apps/server/src/issueAutomation/connectors/zentao/ZenTaoClient.ts",
      "line": 524,
      "description": "裸主机的两套协议按顺序共用十次预算。首轮的多个 404 和根页面探测会挤掉第二轮靠后的候选路径。",
      "suggestion": "给备用协议保留预算，或在总上限内交错探测两个协议。",
      "raisedByModels": [
        "codex:gpt-6.2-sol"
      ]
    },
    {
      "severity": "minor",
      "title": "移动全屏上报的可用高度包含权限栏",
      "filePath": "apps/mobile/src/features/threads/McpAppWebView.tsx",
      "line": 699,
      "description": "权限栏与 WebView 分占全屏高度，宿主仍把外层高度发给应用。按该值布局的内容可能超出可视区域。",
      "suggestion": "测量 WebView 容器的实际高度，权限栏出现或消失时更新宿主上下文。",
      "raisedByModels": [
        "antigravity:gemini-4-carbon"
      ]
    },
    {
      "severity": "minor",
      "title": "新建连接后刷新了旧连接的查询",
      "filePath": "apps/web/src/components/issueAutomation/IssueAutomationPage.tsx",
      "line": 1760,
      "description": "新建后切换连接的同一回调仍刷新本次渲染绑定的列表和详情，可能向旧连接发出多余请求。",
      "suggestion": "新建时由选择变化加载新连接，仅在编辑当前连接时手动刷新。",
      "raisedByModels": [
        "antigravity:gemini-4-carbon"
      ]
    },
    {
      "severity": "minor",
      "title": "八种语言的编辑连接入口仍显示英文",
      "filePath": "apps/web/src/i18n/translations/de.json",
      "line": 6155,
      "description": "德、西、法、日、韩、巴西葡语、俄、瑞典语的新增文案均为 Edit connection。",
      "suggestion": "补齐该键的八种译文并检查界面显示。",
      "raisedByModels": [
        "antigravity:gemini-4-carbon"
      ]
    }
  ]
}
```
