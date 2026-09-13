# CBM 五端探索流程验收

日期：2026-09-13。范围：当前 Blue-Whale 仓库及其 worktree，Codex、Claude Code、ZCode、Kimi Code CLI、Qoder CLI 与子代理。

## 实现与边界

统一政策见 `agent-rules/code-discovery.md`。首次只读探索即适用；建 worktree 不是查询入口。Hook 只注入提醒、恒放行。索引操作不算查询。无法使用或覆盖不足时记录证据并定向查源码。

实现位于任务 worktree `chore-8b71a747`，基线 `01fe1fb63dceeee5aca7a897fe39877c89936b66`。未合入原 release，未推送远端。Kimi 安装器已安装用户级转发 shim 与托管配置块；策略从当前仓库读取。未修改客户端模型或升级全局 CLI。

## 自动检查

- CBM 黑盒回归：12 项通过。覆盖提醒、同仓 worktree、无关仓库静默、子代理事件、Kimi 提示上下文、异常放行及五端配置。
- 控制面 Python 联合回归：71 项通过。
- 规则与验证分类 Node 回归：72 项通过。
- 既有 Hook 测试：679/679 通过；Hook 合同检查通过。
- 独立审查发现 Qoder 配置被忽略；已添加仅 `.qoder/settings.json` 的入库例外，个人覆盖仍被忽略。

这些检查验证脚本和配置，不代表全部客户端真实生命周期验收通过。

## 真实客户端记录

共同任务：新会话在任务 worktree 只读定位 BottomDialog 定义及一个本地模块，不创建分支、不修改文件。通过实际工具记录判定查询，不仅依赖最终自述。

| 客户端 | 实际上下文注入 | 实际结构查询 | 结果/限制 |
|---|---|---|---|
| Claude Code | SessionStart 项目提醒成功 | list_projects、index_status、search_graph、get_code_snippet、check_index_coverage 各一次 | 首次探索通过 |
| Kimi Code CLI | UserPromptSubmit 项目提醒成功 | 上述五类调用各一次 | 首次探索通过；kimi doctor 配置有效 |
| Qoder CLI（qoderclicn 1.1.45） | 项目 SessionStart 成功 | 未执行 | 模型服务拒绝访问，进程退出 1；不能判为查询通过 |
| Codex CLI | 未完成确认 | 未执行 | HTTP 400：当前 gpt-6-astra 要求更新 CLI；不能判为通过 |
| ZCode | 本次未完成 | 本次未完成 | 当前窗口正运行用户任务，未向该任务插入验收指令 |

本机原始输出（不入库，可能含用户环境信息）：`/tmp/cbm-claude-runtime.jsonl`、`/tmp/cbm-kimi-runtime.jsonl`、`/tmp/cbm-qoder-runtime.jsonl`、`/tmp/cbm-codex-runtime.jsonl`。自动检查日志：`/tmp/cbm-control-tests.log`、`/tmp/cbm-rules-tests.log`、`/tmp/cbm-hook-tests.log`。

## 尚待实机验收

五端完整矩阵仍未完成：worktree 切换、真实子代理能力交接、失败/覆盖不足降级、无关仓库静默目前主要由黑盒测试验证。解决客户端版本/模型访问条件后，按统一政策中的五个场景逐端补验；ZCode 使用独立空闲会话。

本任务本身已实际使用 CBM 项目 `Users-kimjohn-Blue-Whale-blue-whale-worktrees-chore-8b71a747`，核查脚本符号与覆盖。full generation `2026-09-13T10:50:52Z`；`.claude` 被排除，Hook 实现已直接精读，未以图谱空结果作不存在结论。
