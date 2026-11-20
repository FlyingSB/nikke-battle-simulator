@AGENTS.md

# Claude Code 专属补充

> 项目规则统一写在 `AGENTS.md`（Claude Code 与 Codex 共用）。本文件只放 Claude 专属内容。

## Playwright MCP
- 使用 `mcp__playwright__*`：在 `~/.claude.json` 用户级注册的 `npx -y @playwright/mcp@latest --extension`，以扩展模式连接用户浏览器。
- 不要用 ECC 插件自带的 `mcp__plugin_*_playwright__*`（版本固定，与新版浏览器扩展协议不兼容）。
- 读页面用 `browser_evaluate` / `browser_snapshot`；崩溃恢复用 `browser_tabs` close 后 new 打开 `http://127.0.0.1:5500`。

## 记忆与交接
- Claude 的私有记忆（`~/.claude/projects/.../memory/`）Codex 看不到。
  凡是「用户纠正 / 项目硬规则」类内容，写进仓库的 `docs/agent-rules.md`；私有记忆只放个人偏好或临时上下文。
- 结束一段工作前更新 `docs/HANDOFF.md`（见 AGENTS.md §0）。
