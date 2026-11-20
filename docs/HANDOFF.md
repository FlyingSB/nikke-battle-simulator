# AI 交接笔记（Claude Code ↔ Codex）

> 开工前读「当前状态」；收工前更新「当前状态」并在「日志」**顶部**追加一条。
> 只写对方需要知道的：做到哪了、没做完什么、下一步、坑。细节放提交信息，这里保持精简。
> 日志超过约 30 条时，把最旧的删掉（git 历史里还有）。

## 当前状态

- **进行中**：无
- **下一步**：见 `TODOS.md` 与 README 待审核角色列表
- **未提交改动 / 分支**：无
- **注意事项**：
  - 角色名写全称、data-catalog「已审核」列不许动等硬规则见 `docs/agent-rules.md`
  - 浏览器只开 `http://127.0.0.1:5500`，不许自启服务器

## 日志

<!-- 格式：
### YYYY-MM-DD · Claude|Codex · 分支 `xxx`
- 完成：…
- 未完成 / 下一步：…
- 坑：…
-->

### 2026-11-20 · Claude · 分支 `claude/project-thread-jl7xuk`
- 完成：建立 Claude / Codex 交接机制。`AGENTS.md` 为共用权威说明，`CLAUDE.md` 改为 `@AGENTS.md` + Claude 专属补充；
  新增 `docs/agent-rules.md`（由 Claude 私有记忆中的用户纠正迁入）与本文件。
- 未完成 / 下一步：用户确认后恢复 Claude 端插件 / MCP（ECC 等）。
- 坑：`AGENTS.md` 中测试表只列主要套件，完整清单以 `scripts/tests/test-all.mjs` 为准。
