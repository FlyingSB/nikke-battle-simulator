# 项目审计报告

**审计时间**: 2026-04-24  
**Git 分支**: `chore/introduce-ecc`  
**主分支**: `main`  
**审计范围**: `src/`、`scripts/`、CLAUDE.md、`.claude/rules/`

---

## 1. 模块清单 + 完成度

### `src/` 模块

| 文件 | 完成度 | 说明 |
|------|--------|------|
| `src/main.js` | **95%** | 入口完整：数据加载 → 队伍渲染 → 模拟 → 结果渲染，含错误处理。 |
| `src/engine/battle.js` | **75%** | 核心模拟器主体完备，但 1600 行超标严重（规则上限 800 行）。含 3 处 TODO（敌人阶段 UI、SG/AR 核心命中率标定、命中率机制）。头注释列出多处"尚未建模"项。 |
| `src/engine/damage.js` | **100%** | 公式全部实现：BaseDamage / CommonMultiplier / ElementMultiplier / ChargeDamageMultiplier / ExtraMultiplier / DamageTakenLikeMultiplier。被 `test-formulas.mjs` 全面覆盖。 |
| `src/engine/stats.js` | **95%** | 7 层属性管线全部实现。`hitRatePct`、`chargeSpeedPct` 字段有意标注"引擎暂未消费"。 |
| `src/engine/constants.js` | **100%** | 纯常量文件，全部有定义。 |
| `src/data/loader.js` | **100%** | localStorage 缓存 + CDN 拉取 + TTL（6 小时）+ stale-while-revalidate + setData 测试钩子。 |
| `src/data/manifest.js` | **90%** | 清单完整。注释中明确"306（Soldier O.W.）URL 尚未抓到"。维护两套并行 URL 映射（旧表标注"请勿直接使用"——技术债）。 |
| `src/data/models.js` | **90%** | 规范化层完整。`parseNikkeDetail` 在 `src/` 中未被任何调用方使用（见 §2 孤立函数）。 |
| `src/data/blablalink-url.js` | **100%** | DJB2 hash + MD5 + 路径混淆 → CDN URL 生成器，完整实现。**但未被任何模块 import**（孤立模块，见 §2）。 |
| `src/ui/squad-builder.js` | **85%** | 5 槽位 UI 完整。文件接近 800 行阈值（612 行）。使用模块级可变 `_state`（违反不可变性约定）。 |
| `src/ui/results.js` | **90%** | 结果渲染完整，单一导出 `renderResults`。 |

### `scripts/` 模块（摘要）

| 文件 | 完成度 | 说明 |
|------|--------|------|
| `scripts/test-formulas.mjs` | **100%** | T1–T32，32 个 section，覆盖 damage 全部分支。 |
| `scripts/test-data.mjs` | **100%** | T1–T11，覆盖 models 层所有主要函数。 |
| `scripts/test-stats.mjs` | **100%** | T1–T8，端到端属性管线（Rapi 参考用例，±1% 容差）。 |
| `scripts/test-battle.mjs` | **80%** | 早期端到端战斗回归 + cache 填充。部分爆裂数值仍为占位。1680 行，超标。 |
| `scripts/test-team-classic.mjs` | **90%** | 经典 5 人队（LM/Crown/Rapi/SBS/Helm）蒙特卡洛回归。 |
| `scripts/lib/test-harness.mjs` | **100%** | eq/near/pct/section/summary 完整。 |
| `scripts/lib/nikke-cache.mjs` | **100%** | CDN 缓存 + manifest 校验完整。 |
| `scripts/lib/full-damage-trace.mjs` | **100%** | 统一时间线打印模板，505 行。 |
| `scripts/trace-*.mjs` × 12 | **100%** | 一次性诊断脚本，各自独立可运行。大量重复代码（每个都重新 import simulate + 读 cache）。 |
| `scripts/update-manifest.js` | **90%** | puppeteer 抓取 + 重写 manifest，逻辑完整。 |
| `scripts/analyze-captures.js` | **80%** | 依赖 `captured_nikke_data.json` 输入文件。 |
| `scripts/analyze_atk*.py` × 8 | — | 一次性数据探索脚本，同一逻辑的 8 个版本迭代，视为积累的杂物。 |

---

## 2. 模块间真实依赖关系

### Import 清单（仅 `src/`，来自代码实际 import 语句）

| 文件 | 直接 import |
|------|-------------|
| `src/main.js` | `data/loader`, `ui/squad-builder`, `ui/results`, `engine/battle`, `engine/stats` |
| `src/engine/battle.js` | `engine/damage`, `engine/stats`, `engine/constants`, `data/models` |
| `src/engine/damage.js` | `engine/constants` |
| `src/engine/stats.js` | `data/models` |
| `src/engine/constants.js` | —（叶节点）|
| `src/data/loader.js` | `data/manifest` |
| `src/data/manifest.js` | —（叶节点）|
| `src/data/models.js` | `data/loader` |
| `src/data/blablalink-url.js` | —（叶节点，**孤立**）|
| `src/ui/squad-builder.js` | `data/models`, `data/loader`, `data/manifest` |
| `src/ui/results.js` | —（叶节点）|

### 依赖拓扑（自底向上）

```
constants.js ─────────────────── 叶节点
manifest.js ──────────────────── 叶节点
blablalink-url.js ────────────── 叶节点（孤立，无入边）
results.js ───────────────────── 叶节点（仅 main 引用）

loader.js  → manifest.js
models.js  → loader.js
damage.js  → constants.js
stats.js   → models.js

battle.js  → damage.js, stats.js, constants.js, models.js
squad-builder.js → models.js, loader.js, manifest.js

main.js    → loader.js, squad-builder.js, results.js, battle.js, stats.js
```

### 循环依赖

**未发现循环依赖。** `models.js → loader.js` 是单向的（models 调用 loader 的 `getData`/`setData`，loader 不反向依赖 models）。

### 孤立模块

- **`src/data/blablalink-url.js`**：完整实现（MD5 + 路径混淆 → CDN URL），但 `src/` 和 `scripts/` 中均无任何 import 引用。属于"已实现但未接入"的工具。
- **`parseNikkeDetail`（`models.js` 内）**：实现完整，但在 `src/` 中未发现调用方。引擎直接消费原始 `shot_detail` 等字段，未走此规范化路径。

---

## 3. 测试覆盖现状

### 各模块覆盖明细

| 模块 | 覆盖度 | 覆盖来源 | 说明 |
|------|--------|----------|------|
| `damage.js` | **~95%** | test-formulas T1–T18, T22–T29 | calcDamage 全分支、calcExpectedDamage、距离/元素矩阵全覆盖 |
| `stats.js` | **~85%** | test-formulas T19；test-data T8–T10；test-stats T8 | applyGradeCore、computeFinalStats 有参考用例 |
| `constants.js` | **~100%** | test-formulas T20–T22 | 常量值回归 |
| `models.js` | **~80%** | test-data T1–T11；test-stats T1–T8 | 主要导出函数均有测试；parseNikkeDetail 无测试 |
| `battle.js` | **~60%** | test-battle, test-team-classic, 12 个 trace | 仅端到端，无逐函数 buff/reload/phase 单元测试 |
| `loader.js` | **~30%** | 仅通过 setData 间接测试 | loadAllData、缓存逻辑、refreshOne 无直接测试 |
| `manifest.js` | **~20%** | nikke-cache 间接校验 | 无断言 URL 数量或 URL 不变的回归 |
| `blablalink-url.js` | **0%** | 无 | 孤立模块，且无任何测试 |
| `main.js` | **0%** | 无 | DOM 入口，可接受 |
| `squad-builder.js` | **0%** | 无 | DOM UI，无测试框架 |
| `results.js` | **0%** | 无 | DOM UI，无测试框架 |

### 总体覆盖估计

- **核心数学/数据层**（damage / stats / constants / models）：≈ 90%
- **战斗引擎**（battle.js）：≈ 60%（仅端到端）
- **数据层 I/O**（loader / manifest）：≈ 25%
- **UI 层**（main / squad-builder / results）：0%
- **孤立模块**（blablalink-url）：0%

**项目整体（按行加权）：≈ 45–55%**（battle.js 占 1600 行，仅端到端覆盖拉低了整体数字）。

---

## 4. 与 CLAUDE.md 约定不符的地方

### 4.1 项目结构约定

| 约定 | 实际状况 | 符合？ |
|------|----------|--------|
| `src/data/` – CDN 数据获取与缓存 | 符合 | ✅ |
| `src/engine/` – 战斗模拟逻辑 | 符合 | ✅ |
| `src/ui/` – UI 组件 | 符合 | ✅ |
| `scripts/` – 工具脚本（手动运行） | 符合，但未提及 puppeteer 自动化路径 | ⚠️ |
| 文件 <800 行（rules 约定） | `battle.js` = 1600 行，`test-battle.mjs` = 1680 行 | ❌ |
| 角色技能应按模块拆分 | 所有技能逻辑塞在 `battle.js`，无 `engine/skills/` 子目录 | ❌ |

### 4.2 测试脚本约定

> CLAUDE.md："三个测试脚本覆盖了除技能以外的所有稳定游戏数据……三个脚本必须全部通过（exit 0）。"  
> 同时写道："首次请先运行 test-battle.mjs 以填充缓存"。

| 约定 | 实际状况 | 符合？ |
|------|----------|--------|
| 三个脚本存在且可独立运行 | test-formulas / test-data / test-stats 均完整 | ✅ |
| 三个脚本是全部测试入口 | 还有 test-battle.mjs（cache 填充关键依赖）+ test-team-classic.mjs + 12 个 trace 脚本 | ⚠️ |
| 文档自我矛盾 | CLAUDE.md 描述"三个"但又在注释中引用第四个（test-battle.mjs） | ❌ |

### 4.3 数据更新约定

| 约定 | 实际状况 | 符合？ |
|------|----------|--------|
| 手动查看 Network 标签页更新 manifest | manifest.js 有 MANIFEST_VERSION 触发缓存失效 | ✅ |
| CLAUDE.md 未提及自动化路径 | `scripts/update-manifest.js`（puppeteer 全自动）已存在 | ⚠️ 文档落后于代码 |
| 一份 NIKKE URL 映射 | 实际维护两套：`NIKKE_URLS`（旧，标注"请勿直接使用"）和 `NIKKE_URLS_BY_ROSTER_ID`（新） | ❌ 旧表应删除或明确废弃 |

### 4.4 不使用 npm / 不使用 TypeScript

> CLAUDE.md："保持纯 JS。主应用不需要 package.json。"

| 约定 | 实际状况 | 符合？ |
|------|----------|--------|
| 主应用无 package.json | 根目录无 package.json | ✅ |
| 不使用 TypeScript | 全部 .js / .mjs，含 JSDoc 类型注释 | ✅ |
| scripts/ 也无 package.json | `scripts/package.json` + `scripts/node_modules/`（puppeteer 等）存在 | ⚠️ CLAUDE.md 约定过于绝对化，未区分 src/ 与 scripts/ 的边界 |

### 4.5 Coding Style 规则（`.claude/rules/zh/coding-style.md`）

| 约定 | 实际状况 | 符合？ |
|------|----------|--------|
| 函数 <50 行 | `tick`（≈400 行）、`initBattle`（≈230 行）、`applyFullBurstSkills`（≈130 行）严重超标 | ❌ |
| 文件 <800 行 | `battle.js`（1600）、`test-battle.mjs`（1680）、`test-formulas.mjs`（894）超标 | ❌ |
| 不可变性优先 | `squad-builder.js` 使用模块级可变 `_state`；battle.js 以可变状态机实现 | ⚠️ battle.js 是有意取舍（性能），squad-builder.js 缺乏充分理由 |
| 无硬编码魔数 | 多处技能数值（`0.1185`、`0.4517`、`0.2099` 等）散布在 battle.js 内 | ⚠️ 有注释说明来源，但应抽到 `engine/skill-tuning.js` |
| 无 console.log | 仅 main.js 的 `console.error`（错误处理，可接受）；测试脚本输出（可接受）| ✅ |

### 4.6 其他未覆盖项

- **`TODOS.md`**（git 未跟踪）：包含路线图但 CLAUDE.md 未提及，应链接或纳入。
- **`captured_nikke_data.json`、`nikke_unique_urls.json`**（git 未跟踪）：中间产物，`.gitignore` 是否涵盖待确认。
- **`test-battle.html`**（git 未跟踪）：HTML 测试入口，CLAUDE.md 未提及其角色。

---

## 优先级建议

| 优先级 | 问题 | 建议动作 |
|--------|------|----------|
| P0 | `battle.js` 1600 行，技能逻辑混杂 | 拆分为 `engine/skills/<unit>.js` |
| P1 | CLAUDE.md 与实际不符（test-battle 地位、自动化脚本、scripts/package.json 边界） | 更新文档 |
| P1 | `manifest.js` 双套 URL 映射 | 删除 `NIKKE_URLS` 旧表 |
| P2 | `blablalink-url.js` 孤立且无测试 | 接入 `loader.js` 或删除 |
| P2 | `parseNikkeDetail` 孤立函数 | 接入引擎或删除 |
| P3 | 12 个 trace 脚本大量重复 | 合并为带参数的单脚本 |
| P3 | `analyze_atk*.py` × 8 个版本 | 删除 7 个旧版本 |
