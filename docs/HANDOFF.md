# AI 交接笔记（Claude Code ↔ Codex）

> 开工前读「当前状态」；收工前更新「当前状态」并在「日志」**顶部**追加一条。
> 只写对方需要知道的：做到哪了、没做完什么、下一步、坑。细节放提交信息，这里保持精简。
> 日志超过约 30 条时，把最旧的删掉（git 历史里还有）。

## 当前状态

- **进行中**：无
- **下一步**：见 `TODOS.md` 与 README 待审核角色列表
- **未提交改动 / 分支**：无（属性公式改写、计算器同步与自动计算均已提交到 `claude/project-thread-jl7xuk`）
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

### 2026-11-21 · Claude · 分支 `claude/project-thread-jl7xuk`
- 完成：基础属性改用 blablalink shiftyspad 角色页算法（逆向自其 `cube-icon-*.js` 的 `combat_formula_debug`）。
  `applyGradeCore` / `GRADE_CORE_C` 删除，新增 `computeBaseStat` + `DEFAULT_STAT_ENHANCE`（读角色 `stat_enhance_detail`）：
  `round((floor(等级×(1+grade×2%)+grade×固定值) + floor(研究) + round(好感度)) × (1+core×2%))`，
  固定值 ATK 20 / HP 3000 / DEF 100；核心倍率放大研究与好感度。
  `equipStatValue` 改为整件 `Math.round(基础 × (1 + 企业 0.3 + 0.1×强化等级))`（.5 进位），用户游戏内实测 8 个值全部吻合；
  旧注释里 T9 企业胸 HP 154686 是记录错误（实际 154687）。T8（Rapi: Red Hood 截图）三项逐位一致（旧公式 HP 偏差约 −0.41%）。
- `tools/stat-calculator.html` 已同步新公式，新增通用 / 职业 / 企业循环室与好感度输入（星级、突破也改为 number 输入），
  内嵌好感度表与循环室每级加成。等级属性改为内嵌 SSR 游戏等级表（差分 + 游程编码）+ 武器类型下拉（SG/SMG/AR/MG/SR/RL，默认 SG）。
  实测规律：ATK 表由 稀有度×职业 决定（9 种），HP 表由 稀有度档×职业（SR 与 R 共用，6 种），DEF 表由 稀有度×职业×武器（37 种）；
  企业 / 元素 / 爆裂无关；唯一例外 Harran（SR 武器却用 SSR 火力 AR 的 DEF 表），计算器并入「AR（含哈兰）」。
  页面只含 SSR（ATK/HP 各 3 张、DEF 18 张），SR / R 注明未做；全部 177 名 SSR × 5 组参数与 `computeBaseStat` 逐项一致（2655 项）。
- 未完成 / 下一步：jsfiddle 版（https://jsfiddle.net/FlyingSB/8pof5csj/）需用户手动同步。
- 坑：火力型 SMG、辅助型 AR 暂无 1400 级角色，表只到 1200 级（页面会提示）；游戏改等级表或出新组合后需从 `src/data/static/nikke/*.json` 重新导出。
- 坑：`test-data.mjs` 依赖 `scripts/cache/`，而静态快照存在时加载器不写缓存，新工作区下该套件会因前置检查失败（与代码无关）。

### 2026-11-20 · Claude · 分支 `claude/project-thread-jl7xuk`
- 完成：建立 Claude / Codex 交接机制。`AGENTS.md` 为共用权威说明，`CLAUDE.md` 改为 `@AGENTS.md` + Claude 专属补充；
  新增 `docs/agent-rules.md`（由 Claude 私有记忆中的用户纠正迁入）与本文件。
- 未完成 / 下一步：用户确认后恢复 Claude 端插件 / MCP（ECC 等）。
- 坑：`AGENTS.md` 中测试表只列主要套件，完整清单以 `scripts/tests/test-all.mjs` 为准。
