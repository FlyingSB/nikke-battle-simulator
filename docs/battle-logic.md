# NIKKE 战斗逻辑参考文档

> 本文档从引擎代码中提炼，描述游戏机制的"应有行为"，不含任何角色/技能的具体数值。用于逐条对照并找出模拟器与实际游戏的偏差。

---

## 目录

1. [时间系统](#1-时间系统)
2. [属性管线](#2-属性管线)
3. [伤害公式](#3-伤害公式)
4. [武器系统](#4-武器系统)
5. [弹药与装填](#5-弹药与装填)
6. [爆裂槽与爆裂序列](#6-爆裂槽与爆裂序列)
7. [Buff 系统](#7-buff-系统)
8. [技能触发系统](#8-技能触发系统)
9. [治疗与护盾](#9-治疗与护盾)
10. [持续伤害（DoT）](#10-持续伤害dot)
11. [敌人系统](#11-敌人系统)

---

## 1. 时间系统

- 模拟以 **60 tick/秒** 推进，1 tick = 1/60 秒。
- 每次调用 `tick()` 推进 1 tick，内部按以下顺序依次执行：
  1. 排入上一 tick 写入的技能事件（`pendingSkillEvents`）
  2. `state.tick++`
  3. 敌人阶段切换检测
  4. 过期 buff 清理
  5. DoT 池触发
  6. HoT（持续治疗）队列处理
  7. 延迟技能命中（`pendingSkillHits`）处理
  8. 过期护盾清理
  9. 爆裂状态机处理（Full Burst 到期 → 阶段超时 → 阶段推进 → 槽填满触发）
  10. 全程定时技能（`INTERVAL`）
  11. 爆裂期间定时技能（`INTERVAL_IN_BURST`）
  12. 每个单位的攻击循环
- 模拟上限：180 秒（10800 tick）。

---

## 2. 属性管线

属性按以下顺序叠加，每步均为**固定值加法**（无百分比乘法）：

| 顺序 | 来源 | 字段 |
|------|------|------|
| 1 | 角色等级表基础值 | `atk / hp / def` |
| 2 | 突破（Grade 0-3） | `× (1 + 0.02×grade) + 20×grade` |
| 3 | 核心（Core 1-7，仅 Grade 3） | `× (1.06 + core×0.0212) + 60 + core×c/7` |
| 4 | 好感度等级 | 固定加值 |
| 5 | T10 装备（每槽 × 强化倍率） | `Math.round(base × (1 + 0.1×level))` |
| 6 | 和谐魔方固定属性 | 按魔方等级索引 |
| 7 | 珍藏品固定属性 | 按物品等级索引 |
| 8 | 研究加成 | 职业 × 阵营研究等级 |
| 9 | 装备词条（均为百分比加成） | 游戏内所有实装装备词条均为百分比加成（含 ATK%）；代码中存在的固定值词条类型（如 `atkFlat`）在游戏中未出现，应忽略 |

### 特殊处理

- **装备词条 atkPct**（"Increase ATK %"）：不计入 `stats.atk`，单独存为 `equipAtkPct`，与技能 ATK% buff **加法**叠加后一起乘。
- **critRate**：基础 0.15 + 装备 critRatePct。
- **critDmg**：基础 0.50 + 装备 critDamagePct（传入 `calcDamage` 的 `critDmgIncrement`）。
- **chargeSpeedPct**：装备词条 + 魔方 Adjutant 被动之和。
- **reloadSpeedPct**：仅来自魔方（Resilience Quick Reload HC），不叠加装备词条。`computeFinalStats` 算入 `stats.reloadSpeedPct` 后，由 `initBattle` 作为永久 buff（`Cube Reload`）推入 `state.buffs`，使换弹时长计算（§5.2）通过 `getBuffSums().reloadSpeedPct` 统一读取；若不推入则会被静默丢弃（换弹按基础时长计算）。
- **elementDmgPct**：装备词条 + 魔方 Anti Code HC 之和。
- **cubeBuffPcts**：魔方主技能中作为开战永久 buff 建模的效果，键为 buff 字段名；由 `initBattle` 作为永久 buff（`Cube`）推入 `state.buffs`，各伤害路径按命中类型从 `getBuffSums` 读取（如仅穿透命中吃 `pierceDamagePct`）。

  | 魔方 | 技能 | buff 字段 |
  |------|------|-----------|
  | Vigor Cube | Priority: Health HC（Max HP ▲） | `maxHpPct` |
  | Destruction Cube | Emergency Part Hit Up HC（Damage to Parts ▲） | `damageToPartsPct` |
  | Piercing Cube | Pierce Hit Up HC（Pierce Damage ▲） | `pierceDamagePct` |
  | Rupture Cube | True Damage Up HC（True Damage ▲） | `trueDamagePct` |
  | Diffusion Cube | Diffusion HC（Distributed Damage ▲） | `distributedDamagePct` |

  其余魔方主技能不建模：命中率（Assault）、蓄力伤害（Onslaught）、弹匣（Wingman）、爆裂充能（Quantum）、防御（Endurance）、减伤（Tempering）、治疗（Healing）、濒危 Max HP（Assist）、掩体 HP（Stealth）。
- **bonusAmmo（装备词条弹药）**：使用 grouped-ROUND 规则 —— 相同 pct 词条分组，每组 `Math.round(baseAmmo × pct × count)`，OL 最多 4 槽。

---

## 3. 伤害公式

```
FinalDamage = BaseDamage
            × CommonMultiplier
            × ElementMultiplier        （仅优越代码克制时，否则 ×1）
            × ChargeDamageMultiplier   （仅当前武器 isCharged=true 时，否则 ×1）
            × ExtraMultiplier
            × DamageTakenLikeMultiplier
```

> **True Damage**：若伤害类型为真实伤害（`isTrueDamage=true`），BaseDamage 计算中敌人防御视为 0（effectiveDef = 0）。

### 3.1 BaseDamage

```
effectiveAtk = ATK × (1 + Σ atkPct) + Σ atkFlat − EnemyDEF × defMultiplier
BaseDamage   = max(0, effectiveAtk) × hitMultiplier × favNormalAttackDamageMult
```

- `atkPct` 汇总：equipAtkPct + 所有生效 buff 的 atkPct（加法叠加）。
- `atkFlat` 汇总：equipAtkFlat + 所有生效 buff 的 atkFlat。
- `hitMultiplier`：普通攻击为 `shot_detail.damage / 10000`；技能伤害为技能描述中的百分比。
- `favNormalAttackDamageMult`：珍藏品 "Normal Attack Damage ▲"（SMG/SG 珍藏品），直接乘在 BaseDamage 上，是**独立乘法**，与 ExtraMultiplier 不相加；**仅加成于该珍藏品对应武器类型的普通攻击**（SMG 珍藏品仅加成 SMG 普攻，SG 珍藏品仅加成 SG 普攻）；**武器切换（`WEAPON_SWITCH`）期间不生效**（视为 1.0）。
- **True Damage**：effectiveDef = 0（完全忽略防御）。

### 3.2 CommonMultiplier

```
CommonMult = 1
  + (0.50 + critDmgIncrement)     当 isCrit=true
  + (1.00 + coreDmgIncrement)     当 isCore=true
  + 0.30                          当武器距离优势生效
  + 0.50                          当 fullBurstActive=true
```

各项均为**加法叠加**，最终结果可超过 2。

### 3.3 ElementMultiplier

- 代码克制关系：燃烧 > 风压 > 铁甲 > 电击 > 水冷 > 燃烧（循环）。
- 当 attacker 的代码克制 defender 时：`ElementMult = 1 + 0.10 + elementAdvantageDmgIncrement`。
- 否则：`ElementMult = 1.0`（无减伤惩罚）。

### 3.4 ChargeDamageMultiplier（当前武器 isCharged=true 时）

```
ChargeMult = (fullChargeDamage / 10000) × (1 + favChargeDmgPct) + (chargeDmgStat - 1)
```

- `fullChargeDamage`：来自 `shot_detail.full_charge_damage`（10000 = ×1.0 基线）。
- `favChargeDmgPct`：珍藏品 "Charge Damage ▲"，仅与 `shot_detail.damage` 相乘（独立项）。
- `chargeDmgStat - 1`：装备/技能/魔方的蓄力伤害加成（加法项），传入形式为 `(1 + chargeDmgPct)`。
- 判定条件为当前武器的 `isCharged=true`，而非武器类型是否为 SR/RL。部分角色通过技能临时切换为可蓄力武器，此时同样应用 ChargeMult。
- `isCharged=false` 时（含非蓄力武器）：ChargeMult = 1.0。

### 3.5 ExtraMultiplier

```
ExtraMult = 1 + Σ(以下各项，生效时才加）
```

| 加成来源 | 字段 | 适用场景 |
|----------|------|----------|
| 攻击伤害% | `attackDamagePct` | 普通攻击和技能均受益 |
| 普通攻击伤害% | `normalAttackDamagePct` | 仅普通攻击（倍率，待验证） |
| 发射体爆炸伤害% | `projectileExplosionDamagePct` | 仅 RL 普攻或标记了 projectileExplosion 的技能命中 |
| 穿透伤害% | `pierceDamagePct` | 仅穿透命中 |
| 依次攻击伤害% | `sequentialAttackDamageMult` | 仅 CDN `skill_type: InstantSequentialAttack` 的技能命中（见下注） |
| 零件伤害% | `damageToPartsMult` | 仅命中零件（Parts）时适用；「零件核心」敌人的核心命中同样适用（见 §3.8、§11.3） |
| 持续伤害% | `sustainedDamagePct` | 仅 DoT |
| 无视防御力伤害伤害% | `trueDamagePct` | 仅 isTrueDamage 命中 |

所有加成为**加法叠加**，再统一 +1 作为乘法项。

> **依次攻击（InstantSequentialAttack）**：CDN `skill_type` 为 `InstantSequentialAttack` 的技能会触发一系列连续打击，每次打击均为独立命中。技能文件通过 `pushBuff({ sequentialAttackDamagePct })` 施加该加成，`getBuffSums` 汇总后由 `fireSkillHit` 以 `opts.isSequentialAttack: true` 传入 `calcDamage`，与 `attackDamagePct` 机制完全对称。

### 3.6 DamageTakenLikeMultiplier

```
DamageTakenMult = 1 + enemyDamageTakenPct + distributedDamagePct
```

- `enemyDamageTakenPct`：对敌 debuff（"Damage Taken ▲"）的累加器，全局共享。
- `distributedDamagePct`：分摊伤害加成（特定技能），与 `enemyDamageTakenPct` 同属承伤类乘法项。

### 3.7 暴击判定

- 普通攻击有效暴击率 = `min(1, stats.critRate + sums.critRatePct + sums.normalAttackCritRatePct)`。
  - `normalAttackCritRatePct`：游戏内"普通攻击暴击率"加成，**不区分蓄力与否**，仅适用于普通攻击（不含技能伤害或爆裂技能）。
- 爆裂技能命中暴击率 = `min(1, stats.critRate + sums.critRatePct)`（不含 normalAttackCritRatePct）。

### 3.8 核心命中判定

敌人核心状态（敌人行动「核心」值）：
- **无核心**（`NONE`）：`state.enemyHasCore = false`，不进行核心命中判定。
- **暴露核心**（`EXPOSED`）：核心暴露，按命中率正常判定。
- **保护核心**（`PROTECTED`）：核心被护甲遮蔽，普通攻击无法命中核心；仅穿透攻击（`isPierce=true`）可命中核心。
- **零件核心**（`PARTS_CORE`）：见 §3.8.2。（旧「穿透双判核心」`PIERCE_DUAL` 已并入此状态，已保存的旧值加载时自动迁移。）
- **命中零件**（`PARTS`）：无核心，所有实弹均命中可破坏零件（`hitPart='parts'`）。

#### 3.8.2 零件核心（PARTS_CORE）

**仅出现于 3 种敌人：Ultra（过激派）、Material H（秘材H）、Storm Bringer（岚灾）。** UI 中选中此状态时会显示该提示。

此类敌人的核心被视作**无限血量的零件**，核心命中判定与暴露核心相同（几何模型 §3.8.1），结算规则：

| 命中方式 | 结算 |
|----------|------|
| 非穿透命中核心 | 1 次核心伤害：CommonMultiplier 核心加成 **+** ExtraMultiplier 零件伤害加成（`damageToPartsPct`） |
| 穿透命中核心 | 1 次核心伤害（同上，另含穿透加成）**+** 1 次本体伤害（纯本体：无核心/零件加成，含穿透加成；独立判定暴击） |
| 爆炸命中（RL 普攻、`projectileExplosion` 技能） | **仅 1 次**。不会像普通零件那样对零件与本体各结算一次 |
| 未命中核心 | 本体伤害（与暴露核心相同） |

**触发效果：** 核心命中**同时算命中核心与命中零件**——`CORE_HIT` / `IS_CORE_HIT` 与 `PARTS_HIT` / `IS_PARTS_HIT` 均触发；技能 handler 内判断「命中零件」须使用 `isPartsHit(state, hitPart)`（如 D: Killer Wife 的 Wipe Out），不要直接比较 `hitPart === 'parts'`。

**穿透武器：** 游戏中穿透仅见于 SG 与 SR（及形似它们的技能切换武器，如 Zwei 爆裂 SR），不存在穿透 RL；因此爆炸命中不会走「穿透额外本体伤害」路径，引擎无需对 RL 特判。

实现：`state.enemyCoreIsParts = true`。`calcDamage` 的 `coreIsParts` 输入使 `hitPart === 'core'` 时同样计入 `damageToPartsMult`；技能命中（`fireSkillHit`）以 `hitPart: 'core'` 命中时亦适用；判定统一由 `battle-utils.js:isPartsHit` 提供。

> 注：普通零件的「爆炸对零件 + 本体两次结算」模拟器本身未建模（`PARTS` 状态下每发仅结算一次零件伤害），故零件核心的爆炸命中无需额外处理，行为天然为一次。

命中率判定（适用于"有核心"及穿透命中保护核心两种情况）：
- **普通攻击**：核心命中率由几何模型 `accuracy.js:coreHitChance` 计算（见 §3.8.1）。躯体恒命中（实战 BOSS 体型庞大），命中率**仅影响核心命中率**。
- **技能命中**：由 `opts.isCore` 显式指定（通常为 false，除非技能说明"命中核心"）。
- **武器切换**（Zwei/Red Hood 等）：缺乏切换武器散布数据，沿用切换武器类型硬编码核心率（SMG 3.3% / SG 20% / 其余 100%）。

#### 3.8.1 核心命中率几何模型（HitRate 机制）

数据实证公式（`dev/game-data.md`，2026-07-07 训练场实测拟合；常量默认值可在敌人配置 UI 调整）：

```
r_core(d) = CORE0 · max(0, 1 − d / D0)            // 核心屏幕半径随距离线性缩小；CORE0=55, D0=77
R_eff     = currentScale / (1 + c · hitRatePct)    // HitRate 收缩散布圆；c=4.5
P_core    = clamp( (r_core / R_eff)², 0, 1 )        // 散布圆内均匀落点命中核心圆的面积比
```

- `currentScale`：武器 auto 散布 scale（SG 250 / SMG 110 / AR 75 / MG 250→10 暖机收束 / SR·RL 无散布）。
- `hitRatePct` = `stats.hitRatePct + sums.hitRatePct`（装备词条 + 技能 buff）。
- **SR/RL/Charged**：精准武器 `alwaysCore=1`（恒核心命中）。散布数据缺失的角色亦保守视为恒核心。
- **MG**：`currentScale` 由暖机 ramp 从 250 收束到 10，核心率随暖机由 ~2% 升到接近 100%。
- **距离优势**：改由各角色 CDN `bonusrange_min/max` 判定（敌人连续距离 ∈ [min,max] → +30%），废弃旧的按武器类型分档 `DISTANCE_ZONES`。

### 3.9 全爆裂补正规则

- `fullBurstActive` 由 `ENTER_FULL_BURST` 触发后置为 `true`，在全爆裂窗口内持续有效。
- **直接伤害类 B3 爆裂技能**：结算顺序在 `ENTER_FULL_BURST` 之前，此时 `fullBurstActive` 尚未为 `true`，自然不受 +50% 补正。
- **普通攻击命中**（全爆裂激活后）：受 +50% 补正。
- **延迟命中**（`pendingSkillHits`）：引擎自动打 `suppressFullBurst=true` 标记，**不受**全爆裂补正。
- 例外：显式标记 `opts.affectedByFullBurst=true` 的技能命中**受**全爆裂补正（如 Rapi: Red Hood）。

---

## 4. 武器系统

### 4.1 武器类型与基础参数

| 武器 | 射速（概率门/tick）| 默认装填（tick） | 距离优势 bonusrange | 散布 scale | 核心命中率 |
|------|-------------------|-----------------|--------------------|-----------|-----------|
| AR   | 0.10（~6发/秒）   | 120（2秒）       | 25–45   | 75      | 几何模型 §3.8.1 |
| SMG  | 0.165（~10发/秒） | 120             | 15–35   | 110     | 几何模型 §3.8.1 |
| SR   | 0.025（蓄力模式）  | 90（1.5秒）      | 45–100  | —（无散布）| 1.0（必中） |
| MG   | 0.135（~8发/秒）  | 180（3秒）       | 35–55   | 250→10 暖机 | 几何模型 §3.8.1 |
| SG   | 0.05（~3发/秒）   | 150（2.5秒）     | 0–25    | 250     | 几何模型 §3.8.1 |
| RL   | 0.025（蓄力模式）  | 180（3秒）       | 0（无优势）| —（无散布）| 1.0（必中） |

> 距离优势与核心命中率均按各角色 CDN 实际字段（`bonusrange_min/max`、`auto_*_accuracy_circle_scale`）判定，上表为各类型标准值。唯一例外：Harran（SR）bonusrange 为 25–45。

> **注**：有 CDN `rate_of_fire` 的单位使用精确 RPM 累加器模型（非概率门）。
> MG 起速单位使用逐发 ramp-up 模型（`mgCurrentRof` 动态变化）。

### 4.2 距离优势（+30%）

| 区间 | 受益武器 |
|------|---------|
| NEAR | SG, SMG |
| MID  | AR, MG  |
| FAR  | SR      |
| RL   | 无距离优势 |

> **武器切换期间**：距离优势判定始终基于角色的**原始武器类型**（`unit.weaponType`），切换武器（`weaponSwitchType`）不影响距离加成区间。

### 4.3 SR/RL 蓄力模式

#### 4.3.1 类型区分（input_type）

CDN `shot_detail.input_type` 决定发射机制，影响发间计算的所有路径：

| 类型 | 代表角色 | 触发方式 | 发间构成 |
|------|---------|---------|---------|
| `UP` | 绝大多数 SR/RL | 按下蓄力，**松手**触发 | backswing + foreswing + effectiveCharge |
| `DOWN_Charge` | Liberalio（SR）、Cinderella 等（RL） | 持续**按住**，满蓄自动连射 | 仅 effectiveCharge |
| `DOWN` | Pascal（RL） | charge_time=0，按下即发 | 由 rateOfFire RPM 累加器控制（不走蓄力路径） |

`isDownCharge = (input_type === 'DOWN_Charge')`；DOWN 型按普通武器处理，本节不适用。

#### 4.3.2 前摇 / 后摇来源

均来自 CDN `shot_detail`，单位百分之一秒（÷100×60 换算为 tick）：

| CDN 字段 | 引擎变量 | 含义 | 已知值 |
|---------|---------|------|--------|
| `spot_first_delay` | `foreswingTicks` | 前摇：重新按下/对准耗时 | 全角色固定 20 cs = 12 t |
| `spot_last_delay` | `backswingTicks`（maintain=0 时使用） | 后摇：松手/恢复耗时 | 全角色固定 20 cs = 12 t |
| `maintain_fire_stance` | 覆盖 `backswingTicks`（>0 时替换） | 持续火力姿态后摇 | 如 Scarlet:BS = 23 cs = 14 t |

#### 4.3.3 effectiveCharge（实际蓄力时长）

基础值：CDN `shot_detail.charge_time`（百分之一秒）÷100×60 = `chargeTimeTicks`（tick）。

```
afterPct        = round(chargeTimeTicks × (1 − min(0.99, stats.chargeSpeedPct + csFromBuff)))
effectiveCharge = max(0, afterPct − flatReductionTicks)
```

| 来源 | 变量 | 是否受 immuneSkillChargeSpeed 屏蔽 |
|------|------|---------------------------------|
| 装备词条 / 魔方 | `stats.chargeSpeedPct` | **不受屏蔽，始终生效** |
| 技能 / buff | `sums.chargeSpeedPct` | 受屏蔽时归零 |
| 技能 flat 减少 | `sums.chargeTimeReductionTicks` | 受屏蔽时归零 |

总折减上限 99%，不允许 effectiveCharge 降为 0。

#### 4.3.4 初始化（战斗开始）

```
chargeTick = foreswingTicks + chargeTimeTicks   // 使用基础值，不应用蓄速
```

UP / DOWN_Charge 均以**基础** `chargeTimeTicks`（不折减蓄速）作为首发等待。DOWN_Charge 首发含前摇（初次对准目标）；首发后进入持续按住状态，之后发间不再含前后摇。

#### 4.3.5 每次射击后（chargeTick 重置）

**UP 型：**
```
chargeTick = now + backswingTicks + foreswingTicks + effectiveCharge
```

**DOWN_Charge 型：**
```
chargeTick = now + max(effectiveCharge, rofFloorTicks)
rofFloorTicks = round(3600 / rate_of_fire)   // RPM 发间下限
```

DOWN_Charge 型持续按住连发，发间受武器 `rate_of_fire`（RPM）下限约束：蓄速把 effectiveCharge 压至近零时（如 Cinderella S1 P2 +100% 蓄速 → 1 t），射速封顶在 RPM 对应发间。Cinderella 180 RPM → 20 t（3 发/s）；Liberalio 200 RPM → 18 t，远低于其 86 t 蓄力发间，不构成约束。UP 型不适用此下限（Scarlet:BS 实测 44 t 发间 < 其 rate_of_fire=60 对应的 60 t，证明 UP 型的 rate_of_fire 字段与发间无关）。

**射后触发器重排：** `FULL_CHARGE` 等射后触发器（onShotFired 派发）在下一发调度**之后**执行，其推入的蓄速 buff（如 Cinderella S1 P2）真机中立即作用于紧接着开始的下一次蓄力。引擎在触发器执行完毕后用最新 buff 汇总重排一次 `chargeTick`（仅当其仍是本次引擎排定值，避免覆盖技能 handler 显式改写）。

**特殊情况（按优先级）：**

1. **武器切换期间**（`WEAPON_SWITCH` 效果激活）：使用 `weaponSwitchChargeTimeTicks`，不加前后摇。
2. **固定蓄力覆盖**（`fixedChargeTimeTicks`，如 Anis:Star 爆裂期间）：忽略技能类蓄速 buff，仅保留 `stats.chargeSpeedPct`（装备/魔方加成）。
3. **Alice Wonderland 快速攻击**：当 `effectiveCharge ≤ round(chargeTimeTicks × 0.0048)`（99.52% 蓄速阈值）时，跳过前后摇，以固定 15 t（= round(60×10/40)）连射。

#### 4.3.6 换弹后（蓄力武器重置）

蓄力武器换弹完成后必须重新经过完整**基础**蓄力（不折减蓄速）才打出第一发，**绝不立即补射**：

**UP 型**（与战斗开始的初始状态一致，含前摇）：
```
chargeTick = reloadEndTick + foreswingTicks + chargeTimeTicks
```

**DOWN_Charge 型**（持续按住，换弹期间不松手、无需重新瞄准，不含前摇）：
```
chargeTick = reloadEndTick + chargeTimeTicks
```

物理含义：UP 型换弹后枪膛回到待击发状态，等价于重新瞄准（前摇）＋蓄力一发。例如 Diesel: Winter Sweets（RL，前摇 0.2s + 蓄力 1.0s）换弹完成后约 1.2s 才打出换弹后第一发，与首发节奏一致。DOWN_Charge 型实测依据：Cinderella 33s = 88 发要求换弹后第一发 = 换弹完成 + 60 t（含前摇则预测 87 发，不符）。

#### 4.3.7 HIDDEN 退出后（chargeTick 重置）

进入 HIDDEN 时 `chargeTick` **不改变**。退出 HIDDEN（进入 NEAR / MID / FAR）时：

**DOWN_Charge 型：**
```
chargeTick = now + effectiveCharge
```

**UP 型：**
```
chargeTick = now + backswingTicks + foreswingTicks + effectiveCharge
```
即完整发间重置。物理含义：HIDDEN 时角色放弃瞄准（等价后摇动作），再次可见时需重新前摇＋蓄力，合计等于一次完整射击周期。

若不重置，每次 HIDDEN 过渡约多出 1 发（4 次 HIDDEN ≈ 多 4 发）。

实测依据（BIGARMS 模式1，4 次 HIDDEN）：

| 角色 | 完整发间 | 不重置预测 | 完整发间重置预测 | 实测 |
|------|---------|-----------|----------------|------|
| Helm（SR） | 84 t | 125 | **121** | 121 ✓ |
| Scarlet: BS（RL） | 44 t | 236 | **232** | 233（±1）✓ |

#### 4.3.8 其他

- 下一发须等 `state.tick >= unit.chargeTick` 才打出（确定性，每蓄力周期恰好 1 发）。
- `chargeSpeedPct` 仅缩短蓄力阶段，前后摇不受影响。
- 蓄力武器爆裂充能：`baseEnergy × (fullChargeDamage / 10000)`（全蓄力加成）。
- **部分蓄力击发（游戏实际 vs 模拟器假设）：** 实际游戏中，SR/RL 无需蓄满即可击发；伤害与爆裂充能按实际蓄力程度等比缩减，仅限全蓄力触发的效果（`FULL_CHARGE` 技能触发、全蓄力专属增益）在未满蓄时不生效。模拟器默认所有 SR/RL 普通攻击均在全蓄力时击发（`isCharged=true`），不建模中途击发场景。

### 4.4 非蓄力武器射击节奏（rate_of_fire 累加器）

适用 AR / SMG / MG / SG（`chargeTimeTicks = 0` 且 CDN `rate_of_fire > 0`）。

**累加器模型**：每 tick `shotAccumulator += rof / 60 / TICK_RATE`（RPM → 发/tick），`shotsThisTick = floor(shotAccumulator)`，发射后扣除整数部分（保留小数，避免高 ROF 的逐 tick 取整损失）。`rof` 可被攻速 buff（`atkSpeedPct`）与 MG 起速（`mgCurrentRof`）覆盖。

**起手立即击发**：`shotAccumulator` 初值为 **1**（而非 0），使开局第一发立即击发，不必空等一个完整射击间隔。物理含义：战斗开始时枪已对准目标。

> **历史偏差（已修复）**：此前累加器从 0 起，每个弹匣首发都要多等一个完整间隔（如 Brid: Silent Track 90 RPM ＝ 0.667s），开局与每次换弹后各损失约一个间隔，导致整体射击数偏低、战斗偏慢。实测帧数据校准（Brid 首弹匣第 9 发 @322t、换弹完成 @396t）后，修正模型误差 ≤3 tick。

**换弹与射击间隔并行消化**：换弹期间累加器按当前 RPM **继续累积，封顶 1 发**；换弹完成后保留累积值、不强制补射。由此：

- 装填时长 ≥ RPM 发间（绝大多数情况，如 AR 2s 装填 vs 0.1s 发间）：累加器在换弹结束前已到 1，换弹完成第一发**立即击发**——与旧"重置为 1"行为完全一致。
- 装填被换弹速度 buff 压缩到发间以内（如换弹速度总和 ≥100% 的瞬间装填）：下一发仍落在**「上一发 + RPM 发间」**，射击节奏回落到武器 RPM，不会出现"每次换弹完成即补射"的超频循环。

> **实测校准（2026-07-17）**：Anis: Sparkling Summer（SG 90 RPM，弹匣 5）15 级 Resilience 魔方（+29.69%）+ S1 Sparkling Boost（+49.28%）+ 爆裂 Sparkling Wave（+27.72%）换弹速度总和 >100%，且爆裂弹匣 ▼73.92% 后仅剩 1 发。实测爆裂 9s 内攻击 14 次 ＝ 精确的 40t（0.667s）RPM 节奏。修复前引擎按"换弹完成即补射"跑出每 13t 一发（后摇 12t + 补射 1t），9s 内 28–31 次，快约 3 倍。

**换弹后摇**：非蓄力武器换弹相位额外计入末发后摇 `reloadRecoveryTicks`（CDN `spot_last_delay`），见 §5.2。

> **与蓄力武器对比（§4.3.6）**：蓄力武器换弹后**绝不立即补射**，须重新经过前摇＋蓄力才打出首发；非蓄力武器换弹后立即恢复 RPM 射击节奏（受上述并行累积约束）。两者机制相反。

### 4.5 MG 起速模型

- 起始射速 = `rate_of_fire`（CDN 值，RPM）。
- 每发射击后：`mgCurrentRof += mgRofChangePerShot`，上限 `mgMaxRof`。
- 不开火时（`shotsThisTick === 0`）：`mgCurrentRof -= mgRofDecayPerTick`，下限 `mgStartRof`。

### 4.6 SG 弹丸

- `shotCount`：每次射击的弹丸数（来自 `shot_detail.shot_count`）。
- `shot_detail.damage` 为所有弹丸合计伤害（`hitMultiplier` 已含合计）。
- 弹丸数变化**不影响**躯体伤害合计（躯体恒命中）；核心命中率按几何模型 §3.8.1 逐发判定。
- 弹丸数**影响爆裂充能**：`target_burst_energy_pershot` 按【每发弹丸】计，详见 §6.1。躯体恒命中 → 按满弹丸数充能。
- **躯体命中**：实战 BOSS 体型庞大，躯体视为恒 100% 命中，命中率**仅影响核心命中率**（§3.8.1）。训练场小体型/有空洞敌人的躯体漏弹（如 Brid 对 BIGARMS NEAR 92.4%/MID 76.9%/FAR 67.3%，见 dev/game-data.md）**未建模**。
- **【TODO 可选】SG 逐弹丸核心拆分**：当前 SG 每次射击按单次 `P_core` 判定整发核心与否（期望 DPS 与逐弹丸 k/N 拆分**数学等价**，蒙特卡洛均值一致）；逐弹丸拆分仅降低方差、细化日志 isCore 标记，为低优先级细化项。

### 4.7 武器切换（WEAPON_SWITCH 效果）

- 期间覆盖 `hitMult`、`weaponType`（可选）、是否蓄力。
- 支持时间制（`seconds`）和回合制（`endRounds`，每发消耗 1 回合）。
- 期间可选无限装弹（`unlimitedAmmo: true`）。
- 切换结束后可有 `backswingTicks` 的封锁期（`weaponSwitchPostBackswingEndTick`）。
- 切换武器后，当前武器弹匣默认为满弹；若有技能在切换时显式设定弹药数，则以技能值为准。
- 可选覆盖：`weaponSwitchCoreRate`（切换武器核心率，缺省按切换武器类型硬编码，见 §3.8）；`weaponSwitchLabel`（命中统计/日志标签，缺省为 `Burst <爆裂技能名>`，切换来源为 S1/S2 时应显式指定，如 Drake: Great Villain S1）。

---

## 5. 弹药与装填

### 5.1 最大弹匣计算

#### 5.1.1 计算公式

最大弹匣由以下所有来源**累加**后统一取下限：

```
rawMax = baseAmmo
       + Math.round(baseAmmo × bonusAmmoPct_OL)      （装备词条，grouped-ROUND）
       + Math.round(baseAmmo × favAmmoPct)            （珍藏品 ammoPct）
       + 技能/Buff 的百分比效果（maxAmmoPct / tempMaxAmmoMult 路径）
       + 技能/Buff 的固定值效果（maxAmmoFlat）

finalMaxAmmo = Math.max(1, rawMax)
```

- 中间计算步骤**不做** `≥1` 保护；仅对 `rawMax` 做一次 `Math.max(1, …)` 。
- `baseAmmo`：CDN `shot_detail` 对应的初始弹数（或武器类型默认值）。

#### 5.1.2 重新计算的时机

`finalMaxAmmo` 只在以下时机重新计算，其余时间读取缓存值：

1. **战斗初始化**：`initBattle` 时确定初始 `maxAmmo`。
2. **推入 Buff 时**：`pushBuff` 时若该 buff 含 `maxAmmoPct` 或 `maxAmmoFlat` 字段，立即对受影响单位重新计算。
3. **Buff 过期时**：过期 buff 含 `maxAmmoPct` 或 `maxAmmoFlat` 字段时，对受影响单位重新计算。
4. **`tempMaxAmmoMult` 写入时**（技能文件直接设置该字段的情况）：设置后立即重新计算。

#### 5.1.3 最大装弹数下降时的行为

当 `finalMaxAmmo` 减小时（扩充效果过期，或缩减效果开始生效），默认行为：

- **保持当前 `ammoLeft` 不变**，但若 `ammoLeft > finalMaxAmmo`，截断至 `finalMaxAmmo`。
- 除非技能描述中显式说明会"立即装填"（Reload）或"清空弹药"。

#### 5.1.4 增减效果同时生效

当最大装弹数的增加效果和减少效果同时生效时，游戏并未明确规定结算顺序，实际测试表明各效果间可能存在某种固定顺序，但模拟器中不做规定：**任何结算顺序均视为合法，不算错误（Undefined 行为）。**

### 5.2 装填流程

1. `ammoLeft <= 0`（且无限装弹未激活）时进入装填。
2. 有效换弹速度：`fixedReloadSpeedPct`（若存在）覆盖所有其他加成；否则使用 `sums.reloadSpeedPct`。
3. 装填时长：`Math.round(reloadTicks × Math.max(0, 1 − effectiveReloadSpeed)) + reloadRecoveryTicks`。
   - **折减部分**：乘法折减（非除以 `1 + speed`）；换弹速度 ≥100% 时为 0（瞬间装填）。例：基础 2s、换弹速度 +29.69% → `120 × 0.7031 ≈ 84 tick ≈ 1.41s`。
   - **`reloadRecoveryTicks`（末发后摇）**：非蓄力武器的 CDN `spot_last_delay`（`maintain_fire_stance > 0` 时覆盖），**不受换弹速度折减**；蓄力武器为 0。例：Brid: Silent Track 基础 1.5s、换弹速度 +29.69%、后摇 0.2s → `90 × 0.7031 + 12 ＝ 63 + 12 ＝ 75 tick ≈ 1.25s`。
4. **装填完成时**计算本次应恢复的弹药量（不在装填开始时计算）：
   - 分段装填（`reloadFraction < 1`）：`Math.min(effectiveMax, Math.round(maxAmmo × reloadFraction))`。
   - 默认一次装满：`effectiveMax`。
5. `effectiveMax` 即 `unit.maxAmmo`（已含所有 buff 和技能效果的缓存值，由 5.1.2 的时机维护）。
6. **装填完成后衔接射击周期**：非蓄力 RPM 武器保留换弹期间并行累积的 `shotAccumulator`（封顶 1；装填 ≥ 发间时已到 1 → 立即击发，装填 < 发间时下一发落在「上一发 + RPM 发间」，见 §4.4）；MG 起速武器 `shotAccumulator = 0`（重新预热）；蓄力武器 `shotAccumulator = 0` 且重置 `chargeTick`（须重新前摇＋蓄力，见 §4.3.6）。

### 5.3 Bastion 魔方（Reload Up HC）

- 每射击 N 发，立即额外补充 `Math.ceil(M)` 发弹药（上限 maxAmmo）。
- 在 `onShotFired` 之后执行（最后一发效果优先）。

### 5.4 弹药相关触发

- `LAST_BULLET`：`ammoAfterShot === 0` 时触发（最后一发打出后）。
- `RELOAD_END`：自然装填完成（`ammoLeft` 恢复至 maxAmmo）时触发。不含技能/道具直接补弹满弹匣的情况。

### 5.5 HIDDEN 阶段弹药

HIDDEN 期间全队停止攻击，按弹匣状态分流（机制详述见 §11.2）：

- **进入 HIDDEN**
  - 弹匣已满，或正处于武器切换（特殊武器）中 → **待命**：不装填、保留弹药。
  - 弹匣未满且非空（`0 < ammoLeft < maxAmmo`）→ **开始装填**：保存 `ammoBeforeHidden`，将 `ammoLeft` 置 0，下一 tick 由装填机制接管。
  - 弹匣已空（`ammoLeft == 0`，本就在装填）→ 装填继续不中断。
- **离开 HIDDEN**
  - 待命单位 → 直接恢复攻击。
  - 自愿装填仍在进行（`ammoBeforeHidden > 0` 且 `reloadTick` 未到）→ 恢复 `ammoBeforeHidden`、取消装填（**弹匣剩余不变**），恢复攻击。
  - 装填已在 HIDDEN 内完成 → 弹匣已满，保持。
  - 弹匣已空的单位 → 装填继续，直到装满。
- SR/RL 蓄力 `chargeTick` 在 HIDDEN 退出时同步重置，见 §4.3.7。

> **注意**：弹匣已满的单位**不**触发装填，因此 HIDDEN 不会误触发其 `RELOAD_END` 技能（§5.4）。

---

## 6. 爆裂槽与爆裂序列

### 6.0 爆裂通用规则

- **阶段推进由施放者决定**：绝大多数角色施放爆裂技能后将爆裂阶段推进到下一阶段；少数角色施放后重新开始当前阶段（不推进）。
- **选角顺序**：若队伍中有多个相同爆裂阶段的角色，**从左到右**依次检查其爆裂技能冷却状态，选择第一个可施放的角色。【TODO】此行为可通过设置改变。

### 6.1 共享爆裂槽

- 总量：1,000,000（实测确认，固定值）。
- 来源：每次普通攻击命中敌人，增加 `targetBurstEnergyPerShot`（CDN 值，已是目标命中值）。
- **Focus（受控）机制 — 蓄力武器充能加成：** 实机同时仅 1 个受控（Focus）角色、可随时切换；模拟器简化为用户在 UI 指定 1 个固定 Focus 槽位（`focusSlot`，仅蓄力武器槽位可选）。蓄力武器（SR/RL）每次普通攻击充能：
  - **非Focus：** `targetBurstEnergyPerShot`（**无全蓄力倍率**）。
  - **Focus：** `targetBurstEnergyPerShot × (fullChargeBurstEnergy / 10000)`（`full_charge_burst_energy` 作百分比系数）。
  - 加成**仅限蓄力武器**；非蓄力武器无论是否 Focus 均为 `targetBurstEnergyPerShot`。
  - 实测验证（G=1,000,000，Privaty 每发 4000）：非Focus Yulha(target 55000)单刷 19 发=⌈1M/55000⌉、Centi(69000)15 发、Trina(72000)14 发、Alice/D:KW(56000)18 发，均 = target；Focus Alice = 56000×3.5 = 196000。
  - **⚠ 影响很大：** Focus 角色蓄力充能可达非Focus 的 2.5–3.5 倍，直接改变整局爆裂循环数。同一队伍实测：Focus Alice 11 次循环、Focus Diesel: Winter Sweets 10 次循环（数据见 dev/game-data.md）。因此 `focusSlot` 的选择必须与实机打法一致，否则循环数与伤害都会偏差。
- **技能附加伤害命中也充能**，每次 = `targetBurstEnergyPerShot`（如 Privaty S2P1、Neon: Vision Eye S1P2、A2 S2P1、Maiden: Ice Rose S2P3、Scarlet: Black Shadow S1 多段）。属独立于「武器普通攻击」的充能源。【TODO 逐角色建模】
- **SG 武器（每发弹丸独立充能）：** `targetBurstEnergyPerShot` 是【每发弹丸】命中敌人的充能值。一次射击发射 `shotCount` 发弹丸，全部命中时本次射击充能 = `shotCount × targetBurstEnergyPerShot`（如 Brid: Silent Track 4000 × 10 弹丸 = 每次射击 40000）。模拟器假设 100% 命中，故按满弹丸数计。
- buff 的 `burstGaugeFlat` 加成：叠加到 `baseEnergy`（按每次射击计、不乘弹丸数），Focus 蓄力时整体再乘以全蓄力系数。
- **仅 `burstPhase === 0` 时累积**；B1–Full Burst 期间停止充能。
- Full Burst 结束后重置为 0。

### 6.2 爆裂序列状态机

```
burstPhase = 0（充能中）
  → 槽满（>= 1,000,000）
    → ENTER_BURST_I 被动触发
    → 等待 B1 单位冷却结束
      → B1 施放（BURST_SKILL_USE）
        → ENTER_BURST_II 被动触发
        → 等待 burstStepTicks（0.1–0.6s，默认 0.6s）
          → burstPhase = 2
          → 等待 B2 单位冷却结束
            → B2 施放（BURST_SKILL_USE）
              → ENTER_BURST_III 被动触发
              → 等待 burstStepTicks
                → burstPhase = 3
                → B3 施放（BURST_SKILL_USE；按 §6.0 从左到右选第一个 CD 就绪的单位；其余 B3 本轮无法施放）
                → ENTER_FULL_BURST 被动触发 → fullBurstActive = true（默认 10s 窗口，可被技能改变）
                → pendingFireInBurstHits 结算
                  → 全爆裂窗口结束后
                    → FULL_BURST_END 触发
                    → fullBurstActive = false，burstGauge = 0，burstPhase = 0
```

> **`fullBurstActive` vs `ENTER_FULL_BURST` 的区别**
>
> - `fullBurstActive`：**状态标志**。由 `ENTER_FULL_BURST` 触发后置为 `true`，生效期完全等于全爆裂窗口（B3 施放完毕后才为 `true`）。用于伤害计算中的 +50% 全爆裂补正（见 3.2）以及 `IN_FULL_BURST` 条件判断。
> - `ENTER_FULL_BURST`：**触发时机**。在所有 B3 施放完毕后触发**一次**，代表"进入全爆裂"事件，用于激活角色被动（如全爆裂时长延长、额外效果等），同时置 `fullBurstActive = true`。
>
> 结果：直接伤害类 B3 爆裂技能结算时 `fullBurstActive` 尚未为 `true`，自然不受 +50% 补正影响，无需额外标记。

### 6.3 阶段超时

- 阶段 1/2/3 各有 10 秒超时（`burstPhaseTimeoutTick`）。
- 若阶段未在 10 秒内推进，爆裂取消，`burstGauge = 0`，`burstPhase = 0`。

### 6.4 缺席处理

- 队伍中不存在 StepN 单位，**或**所有 StepN 单位的爆裂技能均在冷却中：**爆裂阶段无法推进**，进入 6.3 阶段超时流程（10 秒内未推进则取消爆裂）。
- StepN 单位冷却中：等待，每 tick 重试，直到冷却结束或超时。

### 6.5 Full Burst 期间的爆裂技能伤害顺序

1. 某 B3 单位施放爆裂技能（`BURST_SKILL_USE`）；此时 `fullBurstActive` 尚未为 `true`，直接命中不受 +50% 补正。
2. B3 全部施放完毕后触发 `ENTER_FULL_BURST`，置 `fullBurstActive = true`。
3. 延迟命中（`pendingSkillHits`）自动打 `suppressFullBurst=true` 标记，不受全爆裂补正。
4. 处理 `pendingFireInBurstHits`（在 `ENTER_FULL_BURST` 效果生效后才结算的命中，受 `fullBurstActive` 影响）。

---

## 7. Buff 系统

### 7.1 Buff 结构

每个 buff 对象包含：

| 字段 | 含义 |
|------|------|
| `name` | 唯一标识符（同名 buff 刷新不叠加） |
| `unitId` | 目标单位 ID；`null` = 全队 |
| `endTick` | 过期 tick（`Infinity` = 永久） |
| `roundsLeft` | 回合制 buff 剩余回合（每发普攻消耗 1） |
| `atkPct` | ATK% 加成（加法叠加到 atkMultiplier） |
| `atkFlat` | ATK 固定加成 |
| `attackDamagePct` | 攻击伤害%（ExtraMultiplier 加法） |
| `normalAttackDamagePct` | 普通攻击伤害% |
| `critRatePct` | 暴击率加成 |
| `normalAttackCritRatePct` | 普通攻击暴击率加成（不区分蓄力） |
| `critDamagePct` | 暴击伤害加成（增量） |
| `chargeDamagePct` | 蓄力伤害加成（加到 chargeMult） |
| `chargeSpeedPct` | 蓄力速度% |
| `reloadSpeedPct` | 换弹速度% |
| `maxAmmoFlat` | 弹匣容量固定加成（到期时同样截断当前弹药，与 `maxAmmoPct` 行为一致） |
| `maxAmmoPct` | 弹匣容量百分比加成（到期时截断当前弹药） |
| `burstGaugeFlat` | 每发充能固定加成 |
| `enemyDamageTakenPct` | 敌方承伤 debuff（叠加到全局累加器） |
| `atkSpeedPct` | 攻击速度%（影响 RPM） |
| `lifeStealPct` | 生命偷取% |
| `pierceDamagePct` | 穿透伤害% |
| `distributedDamagePct` | 分摊伤害% |
| `sustainedDamagePct` | 持续伤害%（原名 `sustainedDamageMult`，已重命名） |
| `normalAttackTrueDamage` | 布尔标记：普通攻击（含武器切换射击）造成真实伤害——无视防御并计入 `trueDamagePct`（如 Guilty/Sin Bunny Mode: Engage） |
| `stackLimit` | 叠加上限（默认 1；大于 1 时为可叠加效果，见 7.2） |
| `isDebuff` | 是否为 debuff（影响免疫与驱散机制，见 7.3） |

### 7.2 Buff 刷新与叠加规则

- **同名 + 同目标，`stackLimit=1`（默认）**：刷新 `endTick`（取较大值），不叠加。
- **回合制 buff 刷新**：`roundsLeft = max(existing, new)`。
- **不同名 buff 的同类加成**：**加法叠加**（如 ATK% 来自多个技能）。

#### 可叠加效果（`stackLimit > 1`）

- 同名 buff 叠加时，无论是否达到 `stackLimit`（是否新增一层），均刷新 `endTick`（整体持续时间重置）。
- 若当前层数 < `stackLimit`，同时新增一层。
- 到期时**一次性移除全部层数**（非逐层过期）。
- `getBuffSums` 时所有层的数值叠加（如每层 `atkPct=5%`，3 层 = 15%）。

### 7.3 debuff 统一管理

我方受到的 debuff 与敌方受到的 debuff **统一由 buff 机制管理**，通过 buff 对象中的 `isDebuff` 字段加以区分。两者的差异仅在免疫/驱散类技能时体现：

- **免疫**：阻止 `isDebuff=true` 的效果施加（不影响 buff）。
- **驱散**：移除目标身上 `isDebuff=true` 的效果（不影响 buff）。

对敌 debuff（如 `enemyDamageTakenPct`）不需要额外的全局累加器，其到期、刷新、叠加规则与普通 buff 相同，`getBuffSums` 时对敌方单位求和即可。

> **当前实现**：`DEBUFF_ENEMY` 效果仍直接累加到 `state.enemyDamageTakenPct` 全局累加器，尚未迁移至统一 buff 数组管理（待改造）。

### 7.4 getBuffSums

- 对所有 `unitId === null || unitId === targetId` 且 `roundsLeft > 0` 的 buff 求和。
- 从 `unit.equipAtkPct` 和 `unit.equipAtkFlat` 开始（永久装备词条）。

---

## 8. 技能触发系统

### 8.1 触发时机（on 字段）

| 触发 | 时机 | 类型 |
|------|------|------|
| `BATTLE_START` | 战斗开始 | 团队 |
| `ENTER_BURST_I` | 爆裂槽填满那一 tick | 团队 |
| `ENTER_BURST_II` | B1 施放后立即 | 团队 |
| `ENTER_BURST_III` | B2 延迟结束后，B3 施放前 | 团队 |
| `BURST_SKILL_USE` | B1/B2/B3 施放时 | 非团队（ctx.unit = 施放者） |
| `ENTER_FULL_BURST` | 所有 B3 施放完毕后 | 团队 |
| `FULL_BURST_END` | Full Burst 10s 窗口结束 | 团队 |
| `SHOT_COUNT` | 本单位每 N 发普攻 | 非团队（溢出保留） |
| `SQUAD_SHOT_COUNT` | 任意单位射击时广播 | 全员（ctx.shootingUnit） |
| `LAST_BULLET` | 本单位打出最后一发 | 非团队 |
| `FULL_CHARGE` | SR/RL 全蓄力射击 | 非团队 |
| `AMMO_MILESTONE` | 全队消耗弹药累计达到 400/500 发 | 团队 |
| `INTERVAL` | 全程每 N 秒（首次在 t+Ns） | 团队/非团队 |
| `INTERVAL_IN_BURST` | 全爆裂期间每 N 秒 | 团队 |
| `HEAL_RECEIVED` | 某单位受到治疗时触发（ctx.unit = 受治疗者）；全队治疗产生 5 个独立事件，每个事件对应各自受治疗的单位 | 团队 |
| `APPLY_SHIELD` | 某单位获得护盾时触发；全队获盾同样产生 5 个独立事件 | 非团队（仅 caster === ctx.unit 响应） |
| `COVER_HEAL_RECEIVED` | 掩体受到治疗 | 团队 |
| `CORE_HIT` | 命中敌人核心 | 非团队 |
| `RELOAD_END` | 自然装填完成 | 非团队（不含技能补弹） |
| `DURING_FULL_CHARGE` | 全蓄力击发之前（推入的 buff 作用于本次射击） | 非团队 |
| `ONE_MORE` | Persona 联动「1 More」生效于 ctx.unit（技能文件派发） | 非团队 |
| `FOLLOW_UP` | Persona 联动「Follow Up」生效于 ctx.unit（技能文件派发） | 非团队 |
| `BUNNY_MODE_CHANGED` | ctx.unit 的 Bunny Mode 形态变化后（技能文件派发） | 非团队 |

### 8.2 作用范围（target 字段）

| 值 | 目标 |
|----|------|
| `SELF` | 施放者自身 |
| `ALL_ALLIES` | 全体队友 |
| `ENEMY` | 敌人（Boss 战单体） |
| `BURST_CASTERS` | 本轮施放了爆裂技能的队员 |
| `NON_BURST_CASTERS` | 本轮未施放爆裂技能的队员 |
| `BURST_III_UNITS` | `burstStep === 'Step3'` 的单位 |
| `ALLIES_WITH_ELEMENT` | 指定属性的友军 |
| `LOWEST_ATK_BURST_III` | ATK 最低的 B3 友军 |
| `ALL_ALLIES_EXCEPT_SELF` | 除自身以外的所有队友（如 Brid: Silent Track 爆裂技能） |
| `N_ALLIES_EXCEPT_SELF` | 除自身以外的 N 名队友 |
| `N_ALLIES_SELF_LAST` | N 名队友，自身优先级最低（如 Miranda） |

### 8.3 效果类型（effects[].type）

| 类型 | 描述 |
|------|------|
| `BUFF` | 对每个目标单独推入 buff（unitId = 目标 ID） |
| `BUFF_GLOBAL` | 推入全队 buff（unitId = null） |
| `DEBUFF_ENEMY` | 对敌增加承伤%（累加到 enemyDamageTakenPct） |
| `SKILL_DAMAGE` | 技能伤害（count 次，mult 倍率） |
| `HEAL` | 治疗目标（pct×maxHP 或 flat） |
| `RELOAD_AMMO` | 补充弹药（`floor(maxAmmo × pct)`） |
| `REDUCE_BURST_CD` | 减少爆裂技能冷却（秒） |
| `GRANT_BURST_GAUGE` | 增加共享槽（pct × 上限） |
| `AMMO_EXPAND` | 临时扩充弹匣（mult，seconds）+ 立即补满 |
| `STUN_SELF` | 眩晕施放者 N 秒 |
| `WEAPON_SWITCH` | 临时切换武器（hitMult, weaponType, seconds/endRounds） |

### 8.4 条件系统

| 条件类型 | 含义 |
|----------|------|
| `NOT_COMBAT_ASSIST` | 非 Combat Assist 状态 |
| `SQUAD_HAS_BUFF` | 队伍中存在指定 buff |
| `SELF_BUFF_STACKS_GTE` | 自身指定 buff 层数 >= N |
| `ENEMY_BUFF_STACKS_GTE` | 敌方指定 buff 层数 >= N |
| `IN_FULL_BURST` | 全爆裂激活中 |
| `IS_CHARGED` | 本次为蓄力攻击 |
| `IS_CORE_HIT` | 本次命中核心 |

- `conditions` 数组：AND 逻辑（所有条件须同时满足）。
- `any` 数组：OR 逻辑（满足其中一个即可）。

### 8.5 延迟命中（pendingSkillHits）

- 技能通过 `handler` 向 `pendingSkillHits` 推入延迟命中，带 `fireTick`。
- 每 tick 开头处理到期的命中（在 DoT、HoT 之后，攻击循环之前）。
- 引擎自动对所有新入队的延迟命中打 `suppressFullBurst=true`（`affectedByFullBurst` 的除外）。

---

## 9. 治疗与护盾

### 9.1 体力治疗

- `applyHeal(state, target, amount)`：`unitHp = min(maxHp, unitHp + amount)`。
- 治疗后将 target 推入 `pendingHealReceived` 队列。
- `flushHealReceived()` 去重后逐单位触发 `HEAL_RECEIVED`。

### 9.2 HoT（持续治疗）

- 推入 `pendingHoTs`：`{ fireTick, targetId, amount }`。
- 每 tick 处理到期条目，调用 `applyHeal` 并 flush；**会触发 `HEAL_RECEIVED` 事件**，与直接治疗行为一致。

### 9.3 护盾

- `applyShield(state, unit, shieldAmt, shieldEndTick)`。
- 刷新语义：已有护盾时取两者较大值（量与到期 tick 均取 max）。
- 过期护盾在每 tick 开头清理。
- **当前未建模**：护盾仅存储，未参与 HP 扣减计算（HP 直接受伤不经护盾）。

### 9.4 掩体治疗

- `applyCoverHeal(state)` 设置标记。
- `flushCoverHeal()` 触发 `COVER_HEAL_RECEIVED` 团队触发。
- 掩体 HP 不追踪（仅建模事件）。

---

## 10. 持续伤害（DoT）

每条 DoT 记录结构：

| 字段 | 含义 |
|------|------|
| `casterId` | 施放者 ID |
| `label` | 伤害标签 |
| `dotName` | 唯一名称（用于技能查找同名 DoT） |
| `multPerStack` | 每层每次触发的命中倍率 |
| `stacks` | 当前层数 |
| `endTick` | 过期 tick（Infinity = 永久） |
| `nextFireTick` | 下一次触发 tick |
| `intervalTicks` | 触发间隔（60 = 每秒） |
| `sustainedDamage` | true = 受 sustainedDamageMult 加成 |

- 每 tick 开头触发所有 `nextFireTick <= tick` 的条目。
- 总倍率 = `multPerStack × stacks`。
- DoT 使用 `fireSkillHit` 计算，不受普通攻击 hitMult 规则约束。
- DoT 每次伤害都要根据当前最新状态计算伤害值

---

## 11. 敌人系统

### 11.1 敌人参数

| 参数 | 含义 |
|------|------|
| `enemyDef` | 防御值（固定，参与 BaseDamage 计算） |
| `enemyElement` | 敌人属性（影响属性克制判断） |
| `enemyHasCore` | 是否有核心（影响核心命中逻辑） |
| `enemyCoreProtected` / `enemyCoreIsParts` / `enemyHasParts` | 核心状态标志（保护核心 / 零件核心 / 命中零件），见 §3.8 |
| `distanceZone` | 当前距离区间（`NEAR/MID/FAR/null`） |

### 11.2 阶段调度（enemyPhases）

- 配置为 `{ startTick, zone }` 数组，按 startTick 升序。
- 支持区间（Zone）：`NEAR`（近）/ `MID`（中）/ `FAR`（远）/ `HIDDEN`（隐藏，不可瞄准）。
- `NEAR/MID/FAR` 决定 `distanceZone`，影响距离优势加成（见 §4.2）；`HIDDEN` 不更新 `distanceZone`。
- 实测阶段表（BIGARMS 模式1/模式2 等）见 `dev/game-data.md`。

#### HIDDEN（隐藏）阶段

`HIDDEN` 期间敌人无法被瞄准，全队**无法普通攻击**；但**已经触发的技能与 DoT 仍正常造成伤害**（DoT 池、延迟技能命中、HoT 在 tick 内于射击判定之前结算，不受 HIDDEN 影响）。

- **进入 HIDDEN — 全队停止攻击，按状态分流：**
  - 弹匣已满，或正处于武器切换（特殊武器装备切换）中的角色 → **直接待命**（不装填、保留弹药）。
  - 弹匣未满的角色 → **开始装弹**。
  - （已在装弹中的角色装填继续不中断。）
- **离开 HIDDEN（进入 NEAR/MID/FAR）：**
  - 待命角色 → 立即开始攻击。
  - 正在装弹且**弹匣非空**的角色 → 停止装弹，**弹匣剩余不变**，开始攻击（自愿装填被打断）。
  - 弹匣已空的角色 → 装填继续，直到装满。
  - SR/RL 蓄力 `chargeTick` 同步重置（放弃瞄准等价后摇，须重新前摇＋蓄力，见 §4.3.7）。
- 弹药字段层面的具体处理见 §5.5。

### 11.3 可攻击部位

敌人身上可被攻击的部分共 4 种：

| 部位 | 英文 | 说明 |
|------|------|------|
| 本体 | Body | 敌人主体，所有攻击默认命中本体 |
| 核心 | Core | 暴露时可命中，受 CommonMultiplier 核心加成（+100%）；逻辑见 §3.8 |
| 零件 | Parts | 可独立受到"零件伤害增加"加成；见下方实现说明 |
| 阻止部位 | Intercept Parts | 可独立受到"阻止部位伤害增加"加成；当前**未实现**（见附录） |

**关键规则：** 部位特定伤害增加效果（如"对零件伤害增加"、"对阻止部位伤害增加"）**仅在攻击命中对应部位时生效**，不适用于攻击本体或核心的命中。因此，若技能描述为"零件伤害增加 X%"，将其建模为无限制的 `attackDamagePct` 是错误的。

**实现方式（`hitPart` 参数）：** 普通攻击与技能伤害计算均通过 `hitPart`（`'body'` | `'core'` | `'parts'` | `'intercept_parts'`）标识命中部位，默认为 `'body'`（本体）。`damageToPartsPct` buff 仅在 `hitPart === 'parts'` 时计入 `ExtraMultiplier`；例外：「零件核心」敌人（Ultra / Material H / Storm Bringer）的核心命中（`hitPart === 'core'` 且 `coreIsParts`）同时算核心命中与零件命中，两类加成与触发均生效（§3.8.2）。技能文件中，"零件伤害增加"效果应建模为 `damageToPartsPct`（而非 `attackDamagePct`）。当前 Boss 战场景中不产生 `hitPart === 'parts'` 的命中，该加成实际不生效，但建模正确，不再错误叠加到本体/核心命中。

> 当前模拟器中，阻止部位未建模，含有"阻止部位伤害增加"的技能效果暂时忽略。

### 11.4 属性克制关系

```
Fire（燃烧）→ Wind（风压）→ Iron（铁甲）→ Electric（电击）→ Water（水冷）→ Fire（循环克制）
```

克制方在 ElementMultiplier 获得基础 +10% 加成（可被技能进一步提升）。被克制方无减伤惩罚。

---

## 附录：已知未建模或存疑项

| 机制 | 当前状态 |
|------|----------|
| 护盾吸收伤害 | 护盾仅存储，未参与 HP 扣减计算 |
| 核心命中率（HitRate）| ✅ 已建模：几何模型 §3.8.1（散布圆 vs 核心透视半径，受 HitRate 收圆）。躯体恒命中，命中率仅影响核心 |
| 距离优势 | ✅ 已改为各角色 `bonusrange_min/max` + 连续距离判定（废弃武器类型分档） |
| 躯体命中率 | 未建模：实战 BOSS 体型庞大视为躯体恒命中；小体型/有空洞敌人躯体漏弹未覆盖 |
| 掩体 HP | 仅建模事件，不追踪掩体数值 |
| 零件（Parts）命中 | `hitPart='parts'` 已建模；需敌人核心状态设为「命中零件」才产生此命中。普通零件被爆炸命中时对零件+本体各结算一次的机制**未建模** |
| 零件核心（Parts Core）| ✅ 已建模（§3.8.2）：Ultra / Material H / Storm Bringer 专用 |
| 阻止部位（Intercept Parts）命中 | 未建模；含"阻止部位伤害增加"的技能效果暂时忽略 |
