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

---

## 部件系统（Parts / Interruption Parts）

**内容：** Boss 拥有独立 HP 的可摧毁部件。

引擎层面待实现：
- Boss 部件 HP 池（独立于主体 HP 的多 HP 目标）
- PART_DESTROYED 触发事件（部件 HP 归零时分派）
- `damageToPartsMult` 字段：`damage.js` 已有占位，须接入 `getBuffSums` / `fireSkillHit` 管线
- `interruptionPartsDamagePct`：已被 skills/15.js 和 16.js 推入 `state.buffs`，但 `getBuffSums` 未读取
- Snow White: Heavy Arms (471) S2 "Damage to Parts ▲" 暂以 `attackDamagePct` 近似，建模后替换

技能层面（建模部件系统后需补全）：
- Helm (352) S2：Damage to Interruption Parts ▲（持续）
- Rapi: Red Hood (16) S1：Damage to Interruption Parts ▲ 48%（全爆裂时 10s，字段已存未接入）
- Anis: Sparkling Summer (15) S2：Damage to Interruption Parts ▲（全爆裂时 10s，字段已存未接入）
- Raven (851) S2 Blue Blade Part1/2：Vital Attack — Damage to Parts ▲（战斗开始 / 全爆裂，5s）
- Raven (851) S2 Blue Blade Part3：Single Point Attack — Sustained damage ▲（PART_DESTROYED 触发，15s）
- Raven (851) 爆裂 Tempest Effect1：A.N. Mode 移除 Single Point Attack

**背景：** 从 battle.js 顶部注释迁移。优先级低，待 Boss 战模式正式支持时实现。

**依赖 / 阻塞：** 无。

---

## 「可手动切换模式」模拟开关

**内容：** 部分角色的形态 / 武器切换依赖手动操作（满蓄后继续按住、主动装填等），自动战斗永远不会触发。为这类角色在 UI 增加模拟开关（参照 `ebsLastBurstOnly` / `mirLastBurstOnly` 的 store → config 传递方式），让用户选择按「手动打法」模拟。

涉及角色：
- **Guilty: Mighty Bunny (404)**：S1「满蓄后按住 ≥1s」切换 Bunny Mode（Stance ↔ Engage）。当前开局进入 Stance 后恒不变；Engage 分支（普攻 / Mighty Stomp 真实伤害、全蓄力追加真实伤害）已在 `404.js` 实现并有测试（T19），缺触发入口。
- **Sin: Swift Bunny (405)**：同上（S1 P3），Engage 分支（Noise Bullets 真实伤害、爆裂 P4 真实伤害）已在 `405.js` 实现。两人通过 `bunny-shared.js` `enterBunnyMode` 互相带动切换，开关应能表达「何时切换」（如开局即切 Engage / 按固定节奏切换）。
- **Cinderella: Crystal Wave (515)**：S1「Preparation for Change 状态下装填满弹」切换 Snipe Mode（MG → 蓄力狙击，Pierce，全蓄力消耗 40 发）。当前整段未建模（见 `515.js` `[未建模]` 注释），角色恒为 MG 形态，S2 全爆裂恒走「非 Snipe Mode」分支。需先实现 Snipe Mode 武器切换与装填状态机，再接开关。
- **Milk: Blooming Bunny (143)**：未建模。S1「非 Embarrassment 状态下满蓄持续 ≥X 秒」进入 Embarrassment（分摊伤害 + 强制减速装填 + ATK ▲），S2 / 爆裂技能围绕 Embarrassment / Overconfident 状态展开。建模时需同时支持自动（不触发）与手动两种打法。

**原因：** 这些角色的手动打法与自动打法伤害差异很大（真实伤害、切枪），只模拟自动打法会低估手动玩家的实战表现。

**背景：** 2026-09-24 建模 Guilty: Mighty Bunny / Sin: Swift Bunny 时加入。自动战斗判定依据：SR 满蓄即松手，不会产生「按住满蓄」时长。

**依赖 / 阻塞：** Milk: Blooming Bunny 依赖技能建模。Guilty / Sin 无依赖，可直接做。中等优先级。

---

## 修复：武器切换期间普攻珍藏品倍率错误生效

**内容：** `battle.js` 射击循环主伤害路径的 `calcDamage` 调用传入 `favNormalAttackDamageMult: unit.favNormalAttackDamageMult ?? 1`，未在武器切换期间置 1；而零件核心穿透本体、双重命中两条路径以及 hitLog 记录均为 `weaponSwitchActive ? 1 : …`。改为与另两条路径一致即可。

**原因：** 违反 `docs/battle-logic.md` §3.1「武器切换（`WEAPON_SWITCH`）期间不生效」规则，且 hitLog 记录的倍率（1.0）与实际计算不一致，导致战斗日志公式与伤害对不上。实测：Drake: Great Villain（SG 珍藏品 lv15）Super Duper Overdrive 每发伤害被多乘 ×1.0946。

**影响范围：** 所有携带 SG / SMG 珍藏品（Normal Attack Damage Multiplier ▲）且会武器切换的角色，修复后其切换期间伤害会下降——需复核相关测试与已审核角色数值。

**背景：** 2026-09-24 建模 Drake: Great Villain 时通过 trace 公式与实际伤害比对发现。

**依赖 / 阻塞：** 无依赖。高优先级（伤害数值错误）。

---

## Anis: Star 模拟伤害偏高（原因未明）

**内容：** Anis: Star 的模拟伤害高于实测，原因尚未找到。

**背景：** 2026-10-14 记录。

**依赖 / 阻塞：** 无依赖。中等优先级。

---

## Arcana: Fortune Mate 模拟伤害偏低（原因未明）

**内容：** Arcana: Fortune Mate (583) 的模拟伤害比实测低约 11%，原因尚未找到。

**实测对照（2026-10-14）：** 队伍 Tove / Arcana: Fortune Mate / Soda: Twinkling Bunny / Sugar / Drake，全员遗迹巨熊魔方 Lv15，180s，命中参数默认（55 / 77 / 4.5 / 0.7）：

| 角色 | 模拟 | 实测 | 偏差 |
|------|-----:|-----:|-----:|
| Tove | 308,842,058 | 307,955,201 | +0.3% |
| Arcana: Fortune Mate | 1,612,453,986 | 1,816,590,175 | −11.2% |
| Soda: Twinkling Bunny | 7,411,849,904 | 7,202,665,160 | +2.9% |
| Sugar | 5,790,990,961 | 5,424,475,299 | +6.8% |
| Drake | 2,052,864,267 | 1,990,731,235 | +3.1% |

**已排除：**
- S2 P1（Memories and Moments）每 6 发循环正常：补弹 6 / Happy Memories / Precious Moments 均按循环叠层（日志只记首次挂上，叠层不记）。
- 弹丸数 ▲ 摊薄每颗弹丸伤害、整发系数不变（实测确认，规则正确）。
- 珍藏品普攻倍率与 Snapshots of Youth 同一乘区相加后乘武器系数（`battle.js` `normalMultOf` → `damage.js` baseDamage），正确。
- 射速 / 装填正常（180s 共 347 发，几乎不间断）。
- 全局命中参数无法弥合：c 从 4.5 降到 1、SG 弹丸命中率 0.7 / 0.8，Arcana 与 Sugar 的偏差差距始终 13–18 个百分点；降低 c 还会使 Tove 偏低约 10%。

**线索：** Arcana 无自身命中率加成（仅 Drake 全队命中），核心命中（任一弹丸）全爆裂内 47%，低于 Soda 66% / Sugar 56% / Drake 51%。给她加约 29% 装备命中后模拟升至约 1.81B。

**待查：** Keepsake Album 层数与数值（按全爆裂结束时 Precious Moments 层数结算，含自身）；全爆裂外 166 发的增益覆盖与命中；Making Memories 暴击率 ▲（爆裂 Lv7 = 17.35%）是否计入暴击判定。

**依赖 / 阻塞：** 无依赖。中等优先级。
