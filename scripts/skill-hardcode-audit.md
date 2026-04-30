# 技能硬编码逻辑审计
生成时间：2026-04-28
来源文件：src/engine/battle.js · src/data/skill-traits.js · src/engine/skill-executor.js

---

## 架构现状

**已完成重构**：所有技能逻辑已从 `battle.js` 的内联 `unit.name === '...'` 检查迁移至 `src/data/skill-traits.js` 声明式注册表，由 `src/engine/skill-executor.js` 统一分派。

`SKILL_TRAITS` 注册表现已被引擎完整读取。`battle.js` 调用链：
- `executeSkillTriggers(state, trigger)` — 团队级触发（BATTLE_START / ENTER_BURST_I / ENTER_BURST_III / ENTER_FULL_BURST / FULL_BURST_END / AMMO_MILESTONE / HEAL_RECEIVED）
- `onShotFired(state, unit, shotCtx)` — 每发射击后（SHOT_COUNT / LAST_BULLET / FULL_CHARGE / CORE_HIT）
- `onIntervalInBurst(state)` — 全爆裂期间定时触发（INTERVAL_IN_BURST）

### 仍硬编码于 battle.js 的检查（2 处）

| 行 | 写法 | 原因 |
|----|------|------|
| ~806–808 | `unit.name === 'Helm'` | Helm Burst 的 charge damage buff 在 `getBuffSums` 调用之后手动叠入 `sums.chargeDamagePct`，无法声明式化 |
| ~812–817 | `unit.name === 'Moran'` | Moran burst 武器替换期间将 `shotDamageMult` 覆盖为 0.147，属于普通攻击伤害倍率替换，skill-executor 无对应效果类型 |

---

## 触发时机索引

| 时机 | 函数/机制 | 涉及角色 |
|------|----------|---------|
| 战斗初始化 | `executeSkillTriggers('BATTLE_START')` | LM（Bubble debuff）、Rapi（Combat Assist 初始化）|
| 进入 Burst I | `executeSkillTriggers('ENTER_BURST_I')` | Mast（Drunken +1 层）|
| 进入 Burst III | `executeSkillTriggers('ENTER_BURST_III')` | Mast S2（Distributed + Reload Speed）|
| B1/B2/B3 释放 burst | `executeSkillTriggers('BURST_SKILL_USE', {unit})` | LM、Liter、Mast、Anchor、Crown、Rapi、SBS、Cinderella、Nayuta、Moran、Anis:SS、Maiden:IR、Liberalio |
| 进入 Full Burst | `executeSkillTriggers('ENTER_FULL_BURST')` | 所有有 S1/S2 被动的角色（12 个）|
| Full Burst 结束 | `executeSkillTriggers('FULL_BURST_END')` | LM S1 CD 减少、Mast S2 Hangover、Anchor S2、Rapi S1 CA 重置 |
| 每发射击后 | `onShotFired(state, unit, ctx)` | Helm、Rapi、SBS、Crown、Moran、LM、Liberalio |
| 末弹 | `onShotFired` → LAST_BULLET | Helm S1 |
| 全蓄力 | `onShotFired` → FULL_CHARGE | Helm S1 SSR、Helm S2 SSR、Liberalio S1 T2/T3、Liberalio S2 |
| 全蓄力命中核心 | `onShotFired` → FULL_CHARGE + IS_CORE_HIT 条件 | Liberalio S1 T2 |
| 全爆裂期间定时 | `onIntervalInBurst(state)` | LM S2 Bubble Wave |
| 弹药里程碑 | `executeSkillTriggers('AMMO_MILESTONE', {milestone400, milestone500})` | LM S1（400 发）、LM S2（500 发）|
| 友军受治疗 | `executeSkillTriggers('HEAL_RECEIVED', {unit})` | Crown S2 |

---

## 按角色详细清单

### Little Mermaid（resource_id 513 · B1 · AR）
group_id: S1=25131  S2=25132  Burst=15133

**BATTLE_START — S2 Bubble**
- 敌人承伤 ▲5.05%（永久）

**ENTER_FULL_BURST — S1 T1 Bubble Order**
- 全员 `attackDamagePct +0.04`，10s（BUFF_GLOBAL）

**FULL_BURST_END — S1 CD 减少**
- 全员 `burstSkillCooldownEndTick -= 7.48s`（REDUCE_BURST_CD）

**AMMO_MILESTONE — S1 400 发**
- 共享爆裂槽 ▲37% max（GRANT_BURST_GAUGE）

**SHOT_COUNT（LM 自身，every:50）— S2 Explosive Bubble**
- `lmExplosiveBubble = true`（内部状态切换，承伤值不变）

**INTERVAL_IN_BURST（每 1 秒）— S2 Bubble Wave**
- 4×63.36% ATK 技能伤害（HIDDEN 期间也触发）

**AMMO_MILESTONE — S2 500 发**
- 爆裂弹幕 10×85% ATK 技能伤害

**BURST_SKILL_USE — Burst (Siren's Song)**
- 全员 `attackDamagePct +0.1013`，10s（BUFF_GLOBAL）
- 全员补弹 33.26% maxAmmo（补满时取消装填）
- 自身 `atkFlat +17.28% LM.atk`，10s
- 注：handler 实现（补弹逻辑含取消装填判断，无法纯声明式）

---

### Liter（resource_id 82 · B1 · SMG）
group_id: S1=20821  S2=10822  Burst=10823

**ENTER_FULL_BURST — S1 Part 1 Liter Boost（handler）**
- `lmS1FbCount++`（Liter 自身 skillState）
- 爆裂 CD 累进减少（全员）：
  - 第 1 次 FB：-2.34s
  - 第 2 次+：再 -2.70s（累计 -5.04s）
  - 第 3 次+：再 -3.17s（累计 -8.21s/rotation）

**BURST_SKILL_USE — S1 Part 2（handler）**
- `lmS1BurstUseCount++`（Liter 自身 skillState）
- 全员临时弹匣 ▲45.17% baseAmmo，5s（下次装填时生效）
- 第 2 次+：全员 `critDmgBonus +0.1246`，5s
- 第 3 次+：全员 `atkPct +0.1442`，5s

**BURST_SKILL_USE — Burst (Double Boost)**
- 全员 `atkPct +0.66`，5s（BUFF_GLOBAL）

**未建模：** S2（恢复掩体 HP）

---

### Mast: Romantic Maid（resource_id 354 · B2 · MG）
group_id: S1=23541  S2=23542  Burst=13543

**ENTER_BURST_I — S1 A Pirate's Heart（handler）**
- `mastDrunkenStacks +1`（上限 3）
- 首层时推送全员永久 buff：`critRateBonus +0.2005`、`atkFlat +35.02% Mast.atk`
- 同步维护 `mast_drunken` 叠层 buff（stackCount 追踪）

**ENTER_BURST_III — S2 A Pirate's Spirit（handler）**
- 若 `mastDrunkenStacks ≥ 1`：
  - 全员 `distributedDamagePct +0.1503×stacks`，10s
  - 全员 `reloadSpeedPct +0.1504×stacks`，10s
- 注：触发时机为 B3 施放前（旧审计为 `applyFullBurstSkills`，现已修正为 `ENTER_BURST_III`）

**BURST_SKILL_USE — Burst (A Pirate's Romance)**
- 全员 `critDmgBonus +0.4004` + `attackDamagePct +0.1504`，10s
- 若 Drunken ≥1 层：全员 `atkFlat +20.06%×stacks×Mast.atk`，10s

**FULL_BURST_END — S2 Hangover**
- 若 `mastDrunkenStacks = 3`：`mastHangoverEndTick = tick + 10s`；`mastDrunkenStacks = 0`
- 移除 `mast_drunken` 及 `derivedFrom: 'mast_drunken'` 的所有 buff

**battle.js 内联处理 — Hangover 眩晕**
- 每 tick 检查 `mastHangoverEndTick`，眩晕期间跳过该单位所有处理

---

### Anchor: Innocent Maid（resource_id 355 · B2 · RL）
group_id: S1=23551  S2=23552  Burst=13553

**ENTER_FULL_BURST — S1 Part 1 Starfish Omurice（handler）**
- `anchorFbCount++`（Anchor 自身 skillState）
- 第 2 次+：全员 `distributedDamagePct +0.3040`，10s
- 第 3 次+：移除 1 层 Mast Drunken（防 Hangover）；层数归零时清除 S1 passive buffs
- *[TODO] 第 1 次+：全员 HP 回复效能 ▲30.96% 5s — 待治疗系统实现*

**ENTER_FULL_BURST — S1 Part 2 同队 HoT（handler）**
- 若队中有同 squad（Aegis）队员：Anchor 自身 HP 回复 24.32% max HP（简化为一次性；实为 8×3.04%/s HoT）
- 通过 `CHARACTER_TRAITS[id].squad` 字段判断队员归属

**FULL_BURST_END — S2 Sea Anemone Pasta（handler）**
- 基于 `anchorFbCount`：
  - 第 1 次+：全员 `hitRateBonus +0.1013`，10s  ⚠️ 见"待检查"#1
  - 第 2 次+：全员 `atkFlat +35.02% Anchor.atk`，10s
  - 第 3 次+：全员 `reloadSpeedPct +0.4004`，15s

**BURST_SKILL_USE — Burst (Seaside Stroll)**
- 全员 `atkFlat +30.09% Anchor.atk`，10s
- 全员立即 HP 回复 40.18% caster max HP（for 循环调用 `applyHeal`）
- *[TODO] 过量治疗储存 60.19%×MaxHP 25s — 未建模*

---

### Liberalio（resource_id 262 · B3/Step3 · SR）
group_id: S1=22621  S2=22622  Burst=12623

**ENTER_FULL_BURST — S1 T1 Calm Depths**
- 自身 `atkPct +1.60`，3s（声明式 BUFF）

**ENTER_FULL_BURST — S1 T4 chargeSpeed buff（handler）**
- 给队中所有 B3 单位中 ATK 最低者推送 `chargeTimeReductionTicks = round(caster.chargeTimeTicks × 0.1274)`，10s
- 注：使用 flat tick 减少量（非百分比）；⚠️ 见"待检查"#5

**FULL_CHARGE + IS_CORE_HIT 条件 — S1 T2**
- 自身 `attackDamagePct +0.2083`，60s（刷新）

**FULL_CHARGE — S1 T3（handler）**
- 5×40.5% ATK 技能伤害（isCore: false）
- 为 Lib 补充 `burstEnergyPerShot` 能量（×5 次）

**FULL_CHARGE — S2 Raging Current（handler）**
- 首次触发：自身 `attackDamagePct +2.31`，永久（`endTick: Infinity`）
- 通过 `libRagingCurrentActive` 标记防止重复

**BURST_SKILL_USE — Burst (Submerged World)（handler）**
- 自身 `attackDamagePct +0.50`，10s
- 延迟 0.97s 后 925% ATK 技能伤害（enqueue 至 `pendingSkillHits`，fireInFullBurst: true）

---

### Crown（resource_id 330 · B2 · MG）
group_id: S1=23301  S2=23302  Burst=13303

**ENTER_FULL_BURST — S1 One for All（handler）**
- 施放者（burstCastersThisRotation）：`atkFlat +64.51% Crown.atk` + `reloadSpeedPct +0.4435`，15s（per unit）
- 非施放者：`defFlat +37.44% Crown.def` + `reloadSpeedPct +0.4435`，15s（per unit）

**SHOT_COUNT（Crown 自身，every:43）— S2 Relax 叠层（handler）**
- `crownRelaxStacks +1`；满 20 层时归零：
  - Crown 自身 HP 回复 5.23% hp（触发 HEAL_RECEIVED → Crown S2 buff）
  - 全员 `attackDamagePct +0.2099`，7s

**HEAL_RECEIVED（Crown 自身受治疗）— S2（handler）**
- 全员 `attackDamagePct +0.2099`，7s
- 与满层触发共用 buff name `crown_skill2_attackDmg`，pushBuff 刷新语义保证不叠加
- 触发来源：任意 `applyHeal` 后由 `flushHealReceived()` 分派（含 Helm S1 SSR 全员回血）

**BURST_SKILL_USE — Burst (Last Kingdom)（handler）**
- 全员 `attackDamagePct +0.3624`，15s
- 全员护盾 10.45% Crown.hp，15s（刷新取 max(旧, 新)）

**battle.js 内联 — MG ramp**
- `mgCurrentRof` 每发增加 `mgRofChangePerShot`，上限 `mgMaxRof`
- 不发射时 ROF 衰减（`mgRofDecayPerTick`）；装填后重置至 `mgStartRof`

---

### Rapi: Red Hood（resource_id 16 · B3/Step3 · MG）
group_id: S1=20161  S2=20162  Burst=10163

**BATTLE_START + FULL_BURST_END — S1 Combat Assist 状态结算（handler）**
- 队中无原生 B1 → `combatAssistStatus = false`
- 队中有原生 B1 → `combatAssistStatus = configuredCombatAssist`（玩家配置）

**ENTER_FULL_BURST — S1 Scenario C（Combat Assist，handler）**
- 全员爆裂 CD -7.48s
- 全员 `attackDamagePct +0.0802`，10s

**ENTER_FULL_BURST — S1 Scenario D（非 Combat Assist，handler）**
- 自身 `atkPct +0.9504`，10s
- 自身 `interruptionPartsDamagePct +0.48`，10s（字段记录但不计入伤害输出）

**SHOT_COUNT（Rapi 自身，every:1）— S2 Attachable Projectiles（handler）**
- 计数器键：`rapiRawShotCount`（every:1）；手动维护 `rapiShotCount`
- 达到阈值（120/60）后归零：
  - S2_attach：88.11% ATK，isCore=state.enemyHasCore，`extraAttackDamagePct = am-1`
  - 全爆裂中：立即 S2_explode（88.11% ATK，`projectileExplosion: true`，`extraAttackDamagePct = em-1`）
  - 非全爆裂：`rapiPendingProjectile = true`

**ENTER_FULL_BURST — S2 待定 projectile 爆炸（handler）**
- 若 `rapiPendingProjectile`：触发 S2_explode（projectileExplosion: true）

**BURST_SKILL_USE — Burst Scenario C（Combat Assist，handler）**
- 全员 `atkFlat +18.01% Rapi.atk`，10s
- *[TODO] Explosion Radius ▲100.62% — 未建模*

**BURST_SKILL_USE — Burst Scenario D（非 CA，handler）**
- 若 `rapiShotCount ≥ 60`：扣除 60（消耗 projectile 计数）
- 2808% ATK（enqueue 至 `pendingFireInBurstHits`，fireInFullBurst: true）
- 激活增强 S2：`rapiProjectileThreshold = 60`；`rapiProjectileAttachMult = 6.7192`；`rapiProjectileBuffEndTick = tick+10s`

**FULL_BURST_END — S2 参数重置**
- 若 `tick >= rapiProjectileBuffEndTick`：`rapiProjectileThreshold = 120`；`rapiProjectileAttachMult = 2.5072`

---

### Scarlet: Black Shadow（resource_id 225 · B3/Step3 · RL）
group_id: S1=22251  S2=22252  Burst=12254

**SHOT_COUNT（SBS 自身，every:1）— S1 充能循环（handler）**
- 计数器键：`sbsRawCount`（every:1）；手动维护 `sbsChargeCount`（统一 0–9 步）
- 普通模式：每发 +1 步；Burst 模式：每发 +3 步
- 阈值 3/6/9 触发：250.47% / 500% / 750.47% ATK
- 第 6/9 步（普通）/ 第 2/3 步（Burst）：`isDistributed: true`

**ENTER_FULL_BURST — S2 Asura**
- 自身弹匣 ×1.6，10s + 立即补满（声明式 AMMO_EXPAND）

**BURST_SKILL_USE — Burst**
- 自身 `atkPct +1.1512` + `chargeDamagePct +1.5012`，10s
- `sbsBurstChargeModeEndTick = tick+10s`

---

### Helm（resource_id 352 · B3/Step3 · SR）
group_id: S1=23521  S2=23522  Burst=13523

> 所有技能数值从 SSR 收藏品 Antique Compass（`unit.ssrFavSkills`）动态读取，含回退默认值。

**LAST_BULLET — S1 Frontline Command（handler）**
- 全员 `critRateBonus`，5s（dvl[0]，回退 14.64%）

**FULL_CHARGE — S1 SSR（handler）**
- 若 s1Lv > 0：全员 HP 回复（dvl[2]%）；触发 HEAL_RECEIVED → Crown S2
- 全队共享爆裂槽增加（dvl[3]%）

**ENTER_FULL_BURST — S2 Fire Away（handler）**
- 全员 `attackDamagePct`，10s（dvl[1]，回退 11.85%）

**FULL_CHARGE — S2 SSR extra damage（handler）**
- 若 s2Lv > 0：技能伤害命中（dvl[3]%）+ Helm 爆裂槽增加

**BURST_SKILL_USE — Burst (Aegis Cannon)（handler）**
- 伤害：`burstMult × 100% ATK`（dvl[0]，回退 1237.5%）
- 全员 `lifeStealPct`，10s（dvl[1]，回退 54.45%）
- 若 `cdPct > 0`：`helmChargeShots = 10`；`helmChargeDmgBuff = cdPct`

**FULL_CHARGE — Burst charge buff 计数（handler）**
- `helmChargeShots--`；归零时 `helmChargeDmgBuff = 0`

**battle.js 内联（~行 806）— helmChargeDmgBuff 叠入**
- `unit.name === 'Helm'` 检查：`sums.chargeDamagePct += unit.skillState.helmChargeDmgBuff`
- 位于 `getBuffSums` 之后手动叠入，无法声明式化

---

### Moran（resource_id 281 · B2 · AR）
group_id: S1=22811  S2=22812  Burst=12813

**SHOT_COUNT（Moran 自身，every:5）— S1 Bring It On!（handler）**
- 计数器键：`moranBurstS1Count`
- 仅武器替换期间（`moranBurstEndTick` 有效）触发：47.18% ATK 伤害

**BURST_SKILL_USE — Burst (Fair and Square!)**
- `moranBurstEndTick = tick + 10s`；`moranBurstS1Count = 0`

**battle.js 内联（~行 812）— 武器替换伤害覆盖**
- `unit.name === 'Moran'` 检查：`hitMult = 0.147`（替换普通 AR 伤害倍率）

**未建模：** S1 DEF 随 HP 损失被动；S2 嘲讽 + 末弹 debuff

---

### Nayuta（resource_id 223 · B3/Step3 · MG）
group_id: S1=22231  S2=22232  Burst=12233

**BURST_SKILL_USE — Burst (Asceticism)（handler）**
- 全员 `attackDamagePct +0.3545`，15s（先应用，Nayuta 自身命中也受益）
- 两次伤害：275.18% + 645.33% ATK

**未建模：** S1 Indomitability 武器替换；S2 命中率自叠

---

### Cinderella（resource_id 511 · B3/Step3 · SG）
group_id: S1=25111  S2=25112  Burst=15113

**ENTER_FULL_BURST — S1 Beautiful**
- 自身 `atkFlat +2.71% Cinderella.hp`，10s（声明式 BUFF，stat 函数形式）

**BURST_SKILL_USE — Burst (Glass Slippers. Full Contact.)**
- 10×1365.92% ATK 顺序技能伤害（声明式 SKILL_DAMAGE）

**未建模：** S2 诱饵替身

---

### Anis: Sparkling Summer（resource_id 15 · B3/Step3 · SMG）
group_id: S1=20151  S2=20152  Burst=10153

**ENTER_FULL_BURST — S1 Summer Wave（handler）**
- 对队中每个 Electric 单位：`atkFlat +55.31% Anis.atk` + `reloadSpeedPct +0.4928`，10s（per unit）

**BURST_SKILL_USE — Burst (Sparkling Wave)**
- 自身 `reloadSpeedPct +0.2772` + `elementAdvantageBonus +0.4224`，10s
- 弹匣容量变更未建模

**未建模：** S2 末弹 382.42% ATK

---

### Maiden: Ice Rose（resource_id 183 · B3/Step3 · SMG）
group_id: S1=21831  S2=21832  Burst=11833

**BURST_SKILL_USE — Burst (Diamond Dust)**
- 1372.8% × (10% MaxHP + ATK) 技能伤害（`extraAtkFlat = round(caster.stats.hp × 0.10)`）

**未建模：** S1 MP 系统（需 B1 单位）；S2 元素克制加成

---

## 技能状态机字段（skillState，per-unit）

> 注：所有 skillState 字段现均挂载在各自角色的 unit 对象上，不再共享全局 state。

| 字段 | 实际所属角色 | 用途 |
|------|------------|------|
| `lmS1FbCount` | Liter | S1 Part 1 FB 次数，驱动 CD 减少梯度（字段名保留 `lm` 前缀，属于 Liter） |
| `lmS1BurstUseCount` | Liter | S1 Part 2 burst 使用次数（字段名同上） |
| `literAmmoBoostEndTick` | 全员 | Liter S1 T1 弹匣扩充到期 |
| `literAmmoBoostExtra` | 全员 | Liter S1 T1 扩充弹量（整数） |
| `mastDrunkenStacks` | Mast:RM | 0–3，Drunken 层数 |
| `mastHangoverEndTick` | 全员（仅 Mast 写入非零值） | Hangover 眩晕到期 tick |
| `lmShotCount` | LM | 计 50 发切换 Explosive Bubble（counterKey 形式） |
| `lmExplosiveBubble` | LM | Explosive Bubble 是否已激活 |
| `rapiRawShotCount` | Rapi:RH | SHOT_COUNT 原始计数器（every:1） |
| `rapiShotCount` | Rapi:RH | 计 120/60 发触发 S2 projectile |
| `rapiPendingProjectile` | Rapi:RH | 待 FB 爆炸的 projectile 标记 |
| `rapiProjectileThreshold` | Rapi:RH | 120（普通）/ 60（burst 期间） |
| `rapiProjectileAttachMult` | Rapi:RH | 2.5072（被动）/ 6.7192（burst 期间） |
| `rapiProjectileExplosionMult` | Rapi:RH | 固定 2.006，burst 不变 |
| `rapiProjectileBuffEndTick` | Rapi:RH | burst projectile buff 到期 tick（0=未激活） |
| `sbsRawCount` | SBS | SHOT_COUNT 原始计数器（every:1） |
| `sbsChargeCount` | SBS | S1 统一 0–9 步充能计数 |
| `sbsBurstChargeModeEndTick` | SBS | SBS burst 激活的 Burst 模式（每发 +3）到期 |
| `mgCurrentRof` | MG 单位通用 | 当前 RPM（MG ramp 模型；null=无 ramp） |
| `mgMaxRof` | MG 单位通用 | RPM 上限 |
| `mgRofChangePerShot` | MG 单位通用 | 每发 RPM 增量 |
| `mgStartRof` | MG 单位通用 | 装填/不发射后重置用初始 RPM |
| `mgRofDecayPerTick` | MG 单位通用 | 不发射时每 tick 衰减量（0=无衰减） |
| `crownShotCount` | Crown | S2 Relax 计 43 发叠层计数（counterKey 形式） |
| `crownRelaxStacks` | Crown | S2 Relax 当前层数（0–19；满 20 层触发）|
| `helmChargeShots` | Helm | Burst 蓄力额度剩余（max 10） |
| `helmChargeDmgBuff` | Helm | 当前有效的 Burst Charge Dmg 加成值 |
| `anchorFbCount` | Anchor:IM | S1/S2 "前效重复触发"累计次数 |
| `moranBurstEndTick` | Moran | burst 武器替换到期（0=未激活） |
| `moranBurstS1Count` | Moran | 武器替换期间射击计数器（counterKey 形式） |
| `libRagingCurrentActive` | Liberalio | S2 Raging Current 是否已激活 |
| `bastionShotCount` | 通用（Cube） | Bastion Cube 计数 |
| `bastionTriggerRounds` | 通用（Cube） | Cube 触发阈值（0=未装备） |
| `bastionReloadRounds` | 通用（Cube） | Cube 每次补弹量 |
| `intervalLast_skill2` | LM（动态写入） | INTERVAL_IN_BURST 上次触发 tick（由执行器写入） |

---

## 已解决问题记录

1. **✅ Anchor S2 T1 字段已确认正确**：CDN `skill2_detail`（group_id 23552）文本为 "Hit Rate ▲10.13% for 10 sec"，`hitRateBonus: 0.1013` 正确，无需修改。

2. **✅ 命名已修正**：`lmS1FbCount` → `literFbCount`，`lmS1BurstUseCount` → `literBurstUseCount`，battle.js 初始化块与 skill-traits.js handler 同步更新。

3. **✅ Helm 内联叠入已消除**：`unit.name === 'Helm'` 检查已在重构中移除。Burst handler 直接 `pushBuff({ chargeDamagePct: cdPct, endRounds: 10 })`，`getBuffSums` 自动汇总，无残留硬编码。

4. **✅ Moran 武器替换已声明式化**：`unit.name === 'Moran'` 检查已移除。Burst 使用 `WEAPON_SWITCH` 效果类型，battle.js 通过 `unit.skillState.weaponSwitchEndTick / weaponSwitchHitMult` 统一处理。

5. **✅ Liberalio S1 T4 目标范围正确**：不排除 Lib 自身为游戏实际逻辑；若 Lib 是队中唯一 B3，buff 推给自身但无实际影响，逻辑符合游戏行为。

6. **✅ Anchor S1 Part 2 HoT 已正确实现**：改为向 `state.pendingHoTs` 推入 8 条 `{ fireTick: tick + i×TICK_RATE, amount: 3.04% maxHP }` 条目，主循环每 tick 处理并触发 HEAL_RECEIVED，Crown S2 可正确激活 8 次。

7. **✅ `projectileExplosionDamagePct` 伤害公式位置已修正**：RL 武器普通攻击的 `calcDamage` 调用中，`extra.attackDamageMult` 现包含 `sums.projectileExplosionDamagePct`（仅 RL），与 `attackDamagePct` / `normalAttackDamagePct` 同组。Rapi 的 `projectileExplosion` 路径（fireSkillHit）不变，两条路径均正确处理该 buff。
