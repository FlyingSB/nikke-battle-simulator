# TODOS

## Red Hood 独特的爆裂阶段行为

**内容：** "Red Hood"（不是 "Rapi: Red Hood"）拥有独特的 `use_burst_skill` / `change_burst_step`，不遵循标准的 Step1→2→3→Full 链路。找到她的 `resource_id`，读取她的 CDN JSON，并在战斗引擎中把她的爆裂阶段作为特殊情形处理。

**原因：** 一旦她被加入模拟队伍，爆裂轮转会出错。引擎目前假设标准的阶段递进。

**背景：** 2026-04-02 从 CDN 字段复核中加入。`use_burst_skill` 与 `change_burst_step` 位于 `parseNikkeDetail` 中。找到 resource_id 后在此标注。

**依赖 / 阻塞：** 无依赖。在 Red Hood 真正进入模拟队伍前优先级低。

---

## 角色核心命中精度（accuracy circle 相关字段）

**内容：** NIKKE 的 CDN `shot_detail` 中包含 `accuracy_change_pershot`、`accuracy_change_speed`、`start_accuracy_circle_scale` 和 `end_accuracy_circle_scale`。它们定义了持续射击时 accuracy circle 的收缩/扩大，直接影响命中敌人核心的概率。

**原因：** 当前所有射击要么总命中核心、要么从不命中。加入精度模型后可以更真实地模拟核心命中率，尤其对 MG 型 NIKKE（弹匣中途精度会下降）。

**背景：** 2026-04-02 从 CDN 字段复核中加入。字段位于 `parseNikkeDetail`。四个字段在所有 NIKKE 上都有，SG 与 AR 的初始圆大小不同。

**依赖 / 阻塞：** 核心命中概率模型（尚未设计）。中等优先级。

---

## stat_enhance_detail — 验证 grade / core 公式常量

**内容：** 每位 NIKKE 的 CDN JSON 都有 `stat_enhance_detail` 对象，其中包含 grade / core 加成常量。目前 `stats.js` 的 `applyGradeCore` 使用硬编码值（`GRADE_CORE_C = { Attacker: 959, Defender: 931, Supporter: 921 }`）。核对这些值与 CDN 是否一致，或改为动态读取。

**原因：** 若将来补丁修改了常量，硬编码值会悄无声息地偏离实际。

**背景：** 2026-04-02 从 CDN 字段复核中加入。当前所有 NIKKE 共用同一份 `stat_enhance_detail`；公式已确认正确。除非常量发生变化，否则优先级低。

**依赖 / 阻塞：** 无依赖。优先级低。

---

## 为 maxGeneralResearchLevel 增加直接测试

**内容：** 在 `test-data.mjs` 的 T3 中（或新增 T3b 节）加入 3-4 条抽样断言：syncLevel 40 → 0，syncLevel 60 → 10，syncLevel 592 → 270，syncLevel 39 → 0（clamp 检查）。

**原因：** 该函数刚刚从行内代码抽取到 `models.js`。目前没有测试直接断言它 — 只有 `test-stats.mjs` 的 T8 隐式用到了它。一个直接测试能够锁定公式，在未来 CDN 公式更新时捕获回归。

**优点：** 4 条断言，大约 5 分钟。无需拉取 CDN（纯数学）。补齐了 `models.js` 中唯一未测试的导出。

**缺点：** 无明显缺点。

**背景：** 由 `/plan-eng-review` 在 2026-04-02 的代码质量评审中加入。函数位于 `src/data/models.js`。

**依赖 / 阻塞：** 无依赖。优先级低。

---

## 为 test-data.mjs 增加魔方技能值断言

**内容：** 在 `test-data.mjs` 的 T4（和谐魔方）中，对 `normalizeCube()` 解析出的技能值加入断言：Resilience lv15 → `reloadSpeedPct ≈ 0.25`，Anti Code lv15 → `elementDmgPct ≈ 0.1909`，Adjutant lv15 → `chargeSpeedPct ≈ 0.25`。使用 `stats.js` 中已有的 `Math.max(0, level2[cubeLevel-1] - si)` 公式。

**原因：** 魔方技能索引曾是 bug 来源（Anti Code 的 21.21% 与 19.09%）。目前唯一的验证是 `test-stats.mjs` T8 的隐式断言。直接在此处断言就能在隔离场景下提前捕获该类 bug。

**优点：** 把魔方逻辑中最隐晦的部分单独隔离出来。以后新增魔方更安全。

**缺点：** 测试中需要直接读取 `level2` 和 `description_value_list` — 略显冗长但不复杂。

**背景：** 由 `/plan-eng-review` 在 2026-04-02 加入。该 bug 已在本次会话中发现并修复；测试缺口仍在。

**依赖 / 阻塞：** 无依赖。优先级低。

---

## 增加战斗引擎冒烟测试

**内容：** 为 `battle.js` 的 `simulateMonteCarlo` 增加确定性冒烟测试。用固定的队伍配置作为种子（例如单个 Rapi:RH vs 已知敌人），以 N=1 或确定性模式运行，断言：(a) 无错误完成，(b) 造成伤害 > 0，(c) 3 分钟窗口内至少触发一次爆裂。

**原因：** `battle.js` 是引擎中最复杂的文件，目前测试覆盖率为零。任何重构或技能改动都是蒙眼飞行。

**优点：** 即便只是冒烟测试（"能跑出一个数"），也能捕获 import 错误、除零、以及损坏的技能处理器。高价值、低复杂度。

**缺点：** 蒙特卡洛输出非确定性；需要种子化或结构性改动以接受 RNG 参数。中等工作量。

**背景：** 由 `/plan-eng-review` 在 2026-04-02 加入。`simulateMonteCarlo` 位于 `src/engine/battle.js`。

**依赖 / 阻塞：** 无阻塞。待战斗引擎特性稳定后，中等优先级。

---

## 创建 DESIGN.md 设计系统文档

**内容：** 记录设计系统：色彩 token 的语义（`--bg` vs `--surface` vs `--surface2`）、字体角色（body vs `--font-data`）、圆角尺寸（输入框 6px / 卡片 8px / 段落 10px / 模态 12px）、章节层级规则、以及标签色约定（accent=信息，success=已加载，error=失败，dim=未激活）。

**原因：** 没有这份文档，每个新组件都是猜。色彩会悄然漂移。当前的 CSS 变量体系结构良好但无文档 — 未来贡献者（或 6 个月后的你）会改用行内颜色，而不是复用 token。

**优点：** 防止视觉漂移。让 `/design-review` 评审更快。也是 gstack 设计原则的要求。

**缺点：** 对一个单人工具而言 ~30 分钟的文档工作，ROI 较低（如果代码库保持小规模）。

**背景：** 由 `/plan-design-review` 在 2026-04-01 加入。`style.css:5-19` 的 CSS token 系统是事实来源。可运行 `/design-consultation` 从现有代码库生成结构化文档。

**依赖 / 阻塞：** 无依赖。优先级低。
