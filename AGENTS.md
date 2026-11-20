# NIKKE 战斗模拟器 — AI 协作说明（Claude Code / Codex 共用）

> 本文件是所有 AI 代理（Claude Code、Codex 等）共用的**唯一权威说明**。
> `CLAUDE.md` 只通过 `@AGENTS.md` 引入本文件，并补充 Claude 专属内容；项目规则请改这里，不要改两份。

## 0. 每次会话必做（交接协议）

本项目由 Claude Code 与 Codex 交替开发，两边不共享对话记忆，**只靠仓库内文件交接**：

1. **开始前**：读 [docs/HANDOFF.md](docs/HANDOFF.md)（进行中 / 下一步 / 注意事项）和 [docs/agent-rules.md](docs/agent-rules.md)（用户历次纠正沉淀下来的硬规则），再 `git status` / `git log -5` 看对方留下的未提交改动与最近提交。
2. **工作中**：不要覆盖或回退对方未提交的改动；看不懂的改动先问用户。用户新纠正的规则写进 `docs/agent-rules.md`（而不是只写进某一方的私有记忆）。
3. **结束前**（交还给用户 / 对方之前）：按 HANDOFF.md 顶部的格式更新「当前状态」并追加一条日志，写清做完了什么、没做完什么、下一步、坑。
4. 提交信息末尾注明代理，例如 `Co-Authored-By: Claude …` 或 `(by Codex)`，方便对方从 git log 分辨。

## 1. 语言要求

- **所有文档、注释、PR 描述、回复均使用中文**
- 代码变量名、函数名使用英文（遵循语言惯例）
- 复杂业务逻辑的注释必须用中文注明意图

## 2. 开发服务器

本项目使用原生 ES modules — 无需构建步骤。
本地运行时使用 **VS Code Live Server 扩展**（端口 5500）：右键点击 index.html → Open with Live Server。

⚠️ **浏览器自动化规则**（Playwright MCP / Codex 浏览器插件等任何浏览器工具通用）：用户已在 5500 端口开着 Live Server。
- 可以自行打开 `http://127.0.0.1:5500`（新标签页或导航均可），再读取页面 / 执行脚本。
- **必须用 `127.0.0.1`，不要用 `localhost`**：两者是不同的源，浏览器存储（localStorage / IndexedDB）不互通，用户的账号与队伍数据保存在 `127.0.0.1:5500` 下。
- **不要** 自行启动任何服务器（`python -m http.server`、`npx serve` 等一律不行；Live Server 由用户在 VS Code 中开启）。
- 修改 `src/ui/store.js` 读档 / init 路径时，每次保存都必须可运行（Live Server 会在半成品状态刷新，读档异常后自动存档会覆盖用户队伍），详见 agent-rules。

### 通过浏览器工具运行模拟（避免卡死）
模拟在 Web Worker 中运行（`src/ui/sim-runner.js` → `src/engine/sim-worker.js`），主线程始终可响应。
页面上没有全局 `Alpine`，需用同 URL 动态 import 取得同一实例：
`const { default: Alpine } = await import('https://cdn.jsdelivr.net/npm/alpinejs@3.14.3/dist/module.esm.js')`。

- **启动后不要长时间 await**：只触发 `Alpine.store('sim').runSimulate()`（不 await）或点击 ▶ 按钮，立即返回。
- **轮询状态**：用短小的页面脚本读取 `window.__simDiag()`，返回
  `{ state, runId, done, total, elapsedMs, error, heapMB, heapLimitMB }`。
  `state` 取值：`running` / `done` / `error` / `timeout` / `cancelled`；
  超时（30s + 2s × 迭代次数）会自动 terminate Worker 并置为 `timeout`。
- **取消**：`Alpine.store('sim').cancelSimulate()`。
- **判定页面已崩溃**：若一次简单的页面脚本（如 `() => 1`）报错或无响应，视为渲染进程崩溃（OOM 等），
  直接关闭当前标签后新开 `http://127.0.0.1:5500` 恢复，不要等待用户手动关闭。
- `heapMB` 接近 `heapLimitMB` 时先刷新页面再继续批量模拟。

## 3. 项目结构
```
src/data/      – CDN 数据获取与缓存
src/engine/    – 战斗模拟逻辑
src/ui/        – UI 组件
scripts/       – 工具脚本（Node.js，手动运行）
tools/         – 面向用户的独立辅助工具（首页「工具」菜单链接）
                 stat-calculator.html / damage-calculator.html：单文件静态页，与 jsfiddle 版同源，保持不引用 src/
                 blablalink-export.js：blablalink 页面内导出器（书签与油猴共用），不依赖 GM_* API，
                   经 postMessage 回传模拟器（握手协议须与 src/ui/blablalink-import.js 保持一致）
                 blablalink-export.html：书签版安装说明页，书签只是加载上面导出器的加载器
                 blablalink-export.user.js：油猴脚本（@require 导出器），修改后须提高 @version 才会触发用户端自动更新
docs/          – 设计与领域文档（battle-logic / game-data / data-catalog / skill-modeling-guide …）
                 HANDOFF.md：AI 代理交接笔记；agent-rules.md：AI 代理硬规则
```

## 4. 测试套件

全部回归测试由统一入口依次运行（套件清单以 `scripts/tests/test-all.mjs` 为准，下表只列主要几项）：

```bash
node scripts/tests/test-all.mjs
```

| 脚本 | 内容 | 前置条件 |
|------|------|----------|
| `test-formulas.mjs` | 伤害公式纯数学回归（无网络、无 I/O） | 无 |
| `test-skills.mjs` | 技能属性注册表回归 | 无 |
| `test-rapi-burst.mjs` | Rapi 爆裂步骤与 Combat Assist 逻辑 | 无 |
| `test-cinderella.mjs` | Cinderella 技能修正回归 | 无 |
| `test-urls.mjs` | URL 生成算法回归 | 无 |
| `test-data.mjs` | 数据管线（Bond / 装备 / 方块 / 属性管线） | 需先运行 `scripts/tests/test-battle.mjs` 填充 `scripts/cache/` |
| `test-stats.mjs` | 完整属性管线集成测试 | 缓存为空时自动从 CDN 拉取 |
| `test-i18n.mjs` | 界面词典 zh/en 一致性、简体文本补丁、日志游戏文本翻译 | 需已生成 `src/data/static/zh-CN/` |

提交引擎或数据相关的改动之前，`test-all.mjs` 必须全部通过（exit 0）。

## 5. 技能建模
新建或修改 `src/data/skills/*.js` 前阅读 [docs/skill-modeling-guide.md](docs/skill-modeling-guide.md)：
建模检查清单、伤害标签 / 效果段标签 / Buff 命名规范、`unitIds` 多目标合并与 `multiplier` 动态倍率显示。
自定义命名必须在回复中列表汇报。角色名、文件头注释、data-catalog 等硬规则见 [docs/agent-rules.md](docs/agent-rules.md)。

## 6. 数据更新
游戏更新时，CDN URL 的哈希值会发生变化。请更新 `src/data/manifest.js`。
查找新 URL 的方法：在浏览器中打开 blablalink.com/shiftyspad，查看 Network 标签页中
对 sg-tools-cdn.blablalink.com 的请求。

### 新角色 / 花名册更新流程
角色选择器读取 `src/data/static/characters.json`，且只允许选择已在 `SKILL_TRAITS` 注册的角色。
1. `node scripts/download-all-static.mjs`：每次都刷新花名册，自动补下新角色详情 `nikke/<id>.json`，结束时列出新增角色
   （若新角色未出现，先按上节更新 `DATA_URLS.characters` 的哈希）。
2. `node scripts/download-character-images.mjs`（头像）、`node scripts/download-zh-static.mjs`（简体文本）。
3. 建模：新建 `src/data/skills/<id>.js` 并在 `src/data/skill-traits.js` 的 `SKILL_TRAITS` 注册；`docs/data-catalog.md` 加角色行。
4. 浏览器刷新即可。`src/data/loader.js` 对静态快照始终优先读取（`cache: 'no-cache'`），IndexedDB 只缓存 CDN 回退结果，
   **不要**把静态快照重新放进 IndexedDB 缓存，否则更新后的花名册会被旧缓存挡住（曾导致新角色不显示）。

## 7. 界面语言（简体中文 / English）
- 界面文案在 `src/ui/locales/zh.js` / `en.js`（键名必须一一对应），模板用 `$t('key')`，JS 用 `t()`。
- 游戏文本（角色 / 技能 / 魔方 / 珍藏品）：CDN 只有繁中（`zh-tw`），由
  `node scripts/download-zh-static.mjs` 下载并经 OpenCC 转为简体，只保存相对英文快照的文本补丁到
  `src/data/static/zh-CN/`（新增角色或游戏更新后重跑；改术语表 `scripts/lib/zh-cn-glossary.mjs` 后用 `--convert` 离线重生成）。
- 引擎只使用英文数据；日志内部键保持英文，显示时经 `src/ui/game-text.js` 翻译。
- 自动翻译不到的 Buff 名 / 命中标签在人工译名表 `src/ui/locales/zh-game-terms.js` 中填写（优先于自动翻译）；
  新建或修改技能文件后运行 `node scripts/list-untranslated-terms.mjs` 增量补充待译词条（已填译名保留）。

## 8. 不使用 npm / 不使用 TypeScript
保持纯 JS。主应用不需要 package.json。
