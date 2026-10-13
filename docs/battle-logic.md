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
- **reloadSpeedPct**：仅来自魔方（Resilience Quick Reload HC），不叠加装备词条。`computeFinalStats` 算入 `stats.reloadSpeedPct` 后，由 `initBattle` 作为永久 buff（名称取魔方技能原名 `Quick Reload HC`，见 `stats.cubeBuffs`；直接构造 stats 无该字段时回退为 `Cube Reload`）推入 `state.buffs`，使换弹时长计算（§5.2）通过 `getBuffSums().reloadSpeedPct` 统一读取；若不推入则会被静默丢弃（换弹按基础时长计算）。
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
  技能 "Normal Attack Damage Multiplier ▲/▼"（buff 字段 `normalAttackDamageMultPct`）与珍藏品**同一乘区**：
  `favNormalAttackDamageMult = 1 + 珍藏品 + Σ normalAttackDamageMultPct`（与 Charge Damage Multiplier 的处理一致）；
  技能 buff 不受武器类型 / 武器切换限制，对技能产生的普攻命中（`isNormalAttack`）也生效（基数 1，不含珍藏品）。
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
| 普通攻击伤害% | `normalAttackDamagePct` | 仅普通攻击（注意：技能 "Normal Attack Damage **Multiplier**" 不走此处，用 `normalAttackDamageMultPct`，见 BaseDamage） |
| 发射体爆炸伤害% | `projectileExplosionDamagePct` | 仅 RL 普攻或标记了 projectileExplosion 的技能命中 |
| 穿透伤害% | `pierceDamagePct` | 仅穿透命中 |
| 依次攻击伤害% | `sequentialAttackDamageMult` | 仅 CDN `skill_type: InstantSequentialAttack` 的技能命中（见下注） |
| 零件伤害% | `damageToPartsMult` | 仅命中零件（Parts）时适用；实际仅「零件核心」敌人的核心命中会产生（见 §3.8、§11.3.1） |
| 持续伤害% | `sustainedDamagePct` | 仅 DoT |
| 无视防御力伤害伤害% | `trueDamagePct` | 仅 isTrueDamage 命中 |

所有加成为**加法叠加**，再统一 +1 作为乘法项。

> **依次攻击（InstantSequentialAttack）**：CDN `skill_type` 为 `InstantSequentialAttack` 的技能会触发一系列连续打击，每次打击均为独立命中。技能文件通过 `pushBuff({ sequentialAttackDamagePct })` 施加该加成，`getBuffSums` 汇总后由 `fireSkillHit` 以 `opts.isSequentialAttack: true` 传入 `calcDamage`，与 `attackDamagePct` 机制完全对称。

### 3.6 DamageTakenLikeMultiplier

```
DamageTakenMult = 1 + enemyDamageTakenPct + distributedDamagePct
```

- `enemyDamageTakenPct`：对敌 debuff（"Damage Taken ▲"）的 buff 字段（`unitId: '__enemy__'`），由 `getEnemyDamageTakenPct` 汇总未过期条目（含叠层）。
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

> 旧「命中零件」（`PARTS`）状态已移除：普通零件血量难以估算，不参与伤害计算（见 §11.3.1）。已保存的旧值加载时自动迁移为「无核心」（`NONE`）。

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

> 注：普通零件本身不参与伤害计算（§11.3.1），其「爆炸对零件 + 本体两次结算」亦未建模，故零件核心的爆炸命中无需额外处理，行为天然为一次。

命中率判定（适用于"有核心"及穿透命中保护核心两种情况）：
- **普通攻击**：核心命中率由几何模型 `accuracy.js:coreHitChance` 计算（见 §3.8.1）。躯体恒命中（实战 BOSS 体型庞大），命中率**仅影响核心命中率**。
- **技能命中**：由 `opts.isCore` 显式指定（通常为 false，除非技能说明"命中核心"）。
- **武器切换**（Zwei/Red Hood 等）：缺乏切换武器散布数据，沿用切换武器类型硬编码核心率（SMG 3.3% / SG 20% / 其余 100%）。
  技能可设 `skillState.weaponSwitchAccuracyScale`（固定散布圈 scale）改走几何模型（如 K 爆裂 SG，目测 250）；
  `weaponSwitchCoreRate` 优先级最高。

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
- **RL 核心命中（敌人横向移动 × 飞行时间）**：RL 不走几何模型，按 `battle-utils.js:rlCoreHitRate` 判定。
  命中本身即时结算，飞行时间只用于核心判定：
  ```
  飞行帧 f = max(0, 0.603·d − 3.3) × 100 / 弹速     // 弹速 = CDN spot_projectile_speed（多数 RL 为 100）
  命中时刻（出手 tick + f）敌人静止              → P_core = 1
  命中时刻敌人横向移动（敌人配置「横向移动」区间）→ P_core = 1 − clamp(0.028·(f − 10.8), 0, 1)
  ```
  实测（2026-10-13，Anis: Star 单人 vs 射击场 BIGARMS，逐发记录）：静止约 90 发仅 1 发偏离核心；移动中
  距离 20（f≈8）0/30、距离 30/40（f≈15/21）6/25、距离 50（f≈27）14/31。出手 → 命中帧：d20 7/9、d30 18、d40 19、d50 27。
  Anis: Star 的 Shooting Stars 不按飞行时间建模：静止必中核心，移动时 `0.7 × 流星核心命中率修正系数`（界面选项，
  疑与攻击角度有关，由用户按实测调整）。
- **MG**：`currentScale` 由暖机 ramp 从 250 收束到 10，核心率随暖机由 ~2% 升到接近 100%。
- **距离优势**：改由各角色 CDN `bonusrange_min/max` 判定（敌人连续距离 ∈ [min,max] → +30%），废弃旧的按武器类型分档 `DISTANCE_ZONES`。

### 3.9 全爆裂补正规则

- `fullBurstActive` 由 `ENTER_FULL_BURST` 触发后置为 `true`，在全爆裂窗口内持续有效。
- **直接伤害类 B3 爆裂技能**：一律从进入全爆裂开始计时（见 §6.2），由引擎转为延迟命中并打 `suppressFullBurst=true`，**不受** +50% 补正；即时命中预捕获施放时 sums，不受 ENTER_FULL_BURST buff 影响。
- **普通攻击命中**（全爆裂激活后）：受 +50% 补正。
- **延迟命中**（`pendingSkillHits`）：引擎自动打 `suppressFullBurst=true` 标记，**不受**全爆裂补正。
- 例外：显式标记 `opts.affectedByFullBurst=true` 的技能命中**受**全爆裂补正与 ENTER_FULL_BURST buff 影响。建模时按描述措辞判定：B3 描述为 `as additional damage` 时设置（Rapi: Red Hood、Liberalio、Cinderella Part2 已实测；Laplace: Ultimate Hero P3、Sin: Swift Bunny P3 按规则判定），实测例外 Elegg: Boom and Shock（描述 as damage 但受影响），见 [skill-modeling-guide.md §2.1](skill-modeling-guide.md)。若这类命中早于进入全爆裂到期，引擎兜底推迟到 ENTER_FULL_BURST 之后结算。

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
chargeTick = foreswingTicks + round(chargeTimeTicks × (1 − min(0.99, stats.chargeSpeedPct)))
```

装备词条、魔方等效果**开局即生效**，先于任何角色动作与技能，因此首发蓄力同样应用其蓄速加成（`stats.chargeSpeedPct`）。技能 / buff 类蓄速此时尚未推入，不计入首发。UP / DOWN_Charge 均适用。DOWN_Charge 首发含前摇（初次对准目标）；首发后进入持续按住状态，之后发间不再含前后摇。

> 例：Helm（前摇 12 t、基础蓄力 60 t）装备蓄速 +50% → 首发 @ 12 + 30 = 42 t（旧口径不应用蓄速为 72 t）。

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

蓄力武器换弹完成后必须重新经过一次完整蓄力才打出第一发，换弹完成当 tick **不会立即开火**。蓄速加成作用于**每一次**蓄力，换弹后首发也不例外：蓄力时长取 `effectiveCharge`（与 §4.3.3 / §4.3.5 同一口径，含 `immuneSkillChargeSpeed` 屏蔽与固定蓄力覆盖）。

**计算时机**：`effectiveCharge` 在 `RELOAD_END` 触发器执行**之后**按当时的 buff 汇总计算，因此换弹时被移除的蓄速 buff（如 Cinderella S1 P2）不作用于换弹后首发。若 `RELOAD_END` 触发器显式改写了 `chargeTick`（如 Drake: Great Villain 的 Super Duper Overdrive 固定蓄力），以触发器为准。

**UP 型**：末发后摇与换弹**同时计时**（机制见 §4.3.9）。换弹相位结束点取两者中较晚者，之后再前摇＋蓄力：
```
reloadPhaseEnd = lastShotTick + max(backswingTicks, reloadDur)
chargeTick     = reloadPhaseEnd + foreswingTicks + effectiveCharge
```
- 常规情况 `reloadDur ≫ backswingTicks`（如 2s 装填 vs 0.2s 后摇）：后摇被换弹时间完全覆盖，`reloadPhaseEnd = lastShotTick + reloadDur`。
- 换弹时长 < 后摇（如换弹速度 ≥90% 时 Helm 装填 ≤12 t）：换弹在后摇期间完成，但仍须**等后摇结束**才进入前摇，`reloadPhaseEnd = lastShotTick + backswingTicks`。换弹速度 ≥100%（装填 0 t）时同理，**不能**跳过后摇。

> 例：Helm（SR，后摇 12 t、前摇 12 t、蓄力 60 t，无蓄速）换弹速度 +125.20% → 装填 0 t。末发到换弹后首发 ＝ max(12, 0) + 12 + 60 ＝ **84 t**（与常规发间相同），而非忽略后摇的 72 t。

**DOWN_Charge 型**（持续按住，发间无前后摇；换弹动作**不重置也不覆盖**末发后摇与再次按下的前摇，三者**串联**）：
```
chargeTick = reloadEndTick + backswingTicks + foreswingTicks + effectiveCharge
```

> **实测校准（2026-10-09，Anis: Star，后摇 12 t、前摇 12 t、爆裂固定蓄力 42 t）**：
> - 换弹速度 114%（换弹 0 t）：弹匣归 0 到换弹后首发 **66 t** = 0 + 12 + 12 + 42；
> - 换弹速度 74%（Crown + Resilience，换弹 2.0s × 0.26 = 31 t）：**96 t** ≈ 31 + 12 + 12 + 42 = 97。
> 并行模型 `max(换弹, 前后摇) + 蓄力` 对第二组只能给出 73 t，排除；换弹速度封顶模型对第一组给出 90 t，排除。
> 历史依据 Cinderella「33s = 88 发」按串联模型预测 87 发（差 1 发 = 0.4 s，在 33 s 窗口的计时精度内），以帧级实测为准。

物理含义：UP 型换弹后枪膛回到待击发状态，等价于重新瞄准（前摇）＋蓄力一发。例如 Diesel: Winter Sweets（RL，前摇 0.2s + 蓄力 1.0s）换弹完成后约 1.2s 才打出换弹后第一发，与首发节奏一致。DOWN_Charge 型换弹后首发的 `effectiveCharge` 按 `RELOAD_END` 之后的 buff 汇总计算（Cinderella S1 P2 蓄速 +100% 在 `RELOAD_END` 被移除，换弹后首发即基础 60 t）。

> **历史口径（已废弃）**：换弹后首发与开局首发曾使用基础 `chargeTimeTicks`（不应用蓄速）。该假设从未有实测支持（唯一相关实测 Cinderella 因 buff 已被移除而无法区分两种口径），已改为应用 `effectiveCharge`。

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

#### 4.3.9 后摇期间换弹（UP 型蓄力武器）

适用范围：有后摇（`backswingTicks > 0`）的 **UP 型** SR / RL / Charged 武器。DOWN_Charge 型无后摇，不适用。

**机制：** 角色每次攻击后进入后摇时，**立即开始换弹**（弹匣未满即可，不要求打空），换弹与后摇并行计时。设本发射击 tick 为 `T`，本次换弹时长 `reloadDur = round(reloadTicks × max(0, 1 − effectiveReloadSpeed))`（与 §5.2 同一口径）：

| 情况 | 条件 | 结果 |
|------|------|------|
| 后摇中换弹完成 | `reloadDur ≤ backswingTicks` | 在 `T + reloadDur` 时弹匣**补满**；随后等待后摇结束（`T + backswingTicks`），再照常前摇＋蓄力 |
| 后摇打断换弹 | `reloadDur > backswingTicks` 且弹匣未空 | 后摇结束时换弹被**打断**，本次换弹不恢复任何弹药，继续下一次攻击（前摇＋蓄力） |
| 末发打空 | `ammoLeft = 0` | 无弹可打，换弹不会被打断，持续到完成；即 §4.3.6 的「后摇与换弹同时计时」 |

要点：

- **判定时机**：以本发射击后（射后技能触发与 Bastion 补弹结算完毕）的弹药量与换弹速度判定。
- **不改变射击节奏**：后摇期间换弹只影响弹药，不影响发间。无论换弹是否完成，下一发都是 `T + backswingTicks + foreswingTicks + effectiveCharge`（§4.3.5）。
- **日志**：后摇中换弹**成功完成**时，须在 `T + reloadDur` 记录一条装填事件（`type: 'reload'`，含 `ammoRefilled` / `maxAmmo`），计入 `reloadCount`，并触发装填完成相关的技能时机（`onReloadEnd`）。被打断的换弹不记录装填事件。
- **实际效果**：`reloadDur ≤ backswingTicks` 时每发之后都会补满，弹匣永不打空，不再出现换弹停顿。例：Helm 后摇 12 t、基础装填 120 t，换弹速度 ≥90%（装填 ≤12 t）即可达成。
- **分段装填**（`reloadFraction < 1`）：后摇中完成的换弹每次恢复 `round(maxAmmo × reloadFraction)` 发（不超过上限），与 §5.2 一致。

> 末发打空且 `reloadDur ≤ backswingTicks` 时，与「弹匣未空时的后摇中换弹」表现一致：后摇中补满，后摇结束后前摇＋`effectiveCharge`（蓄速作用于每次蓄力，§4.3.6），末发到下一发恰为常规发间。

> **实现**（`battle.js`）：
> - 每发引擎排定的蓄力射击后（射后触发器与 Bastion 补弹之后），`scheduleBackswingReload` 按当时换弹速度计算 `reloadDur`：`≤ backswingTicks` 时登记 `backswingReloadTick = T + reloadDur`（`reloadDur = 0` 则射击当 tick 立即补满），到点由 `refillMagazine` 补满并记录 `reload` 事件、触发 `onReloadEnd`，不改动 `chargeTick`；`> backswingTicks` 且弹匣已空时于射击当 tick 开始常规换弹（`reloadTick = T + reloadDur`）。
> - 常规换弹完成后 UP 型 `chargeTick = max(当前 tick, lastChargeShotTick + backswingTicks) + foreswingTicks + effectiveCharge`。
> - 不适用：武器切换期间（含 Red Hood: Red Wolf）、Alice Wonderland 快速攻击（规避后摇）、无限弹药期间。
> - 回归测试：`test-reload-cadence.mjs` C5–C7。

> **实测依据**：Anis: Star / Crown / Red Hood / Helm / Privaty 队伍全爆裂期间换弹速度 ≥100%，实测 Helm 与 Red Hood（不使用 Red Wolf 时）始终满弹匣；实现前引擎中两者弹药逐发递减、打空后才换弹。

#### 4.3.10 蓄力中途蓄力时长变化（每 tick 重算）

引擎排定的 `chargeTick` 分解为 `chargeBaseTick + chargeFixedTicks + 当前有效蓄力`（`scheduleEngineCharge`），并记录 `engineChargeTick`。每 tick 射击判定前 `rescheduleEngineCharge` 用当前 buff 汇总重算：

- 蓄速 buff 推入/过期、固定蓄力（如 Anis: Star 爆裂 0.7s）生效/过期时，正在进行的这一次蓄力**按新时长结算**；
- 已蓄力时长 ≥ 新时长 → 视为已满蓄，**当 tick 立即击发**；
- 技能 handler 显式改写过 `chargeTick`（与 `engineChargeTick` 不等）、武器切换期间、Alice Wonderland 快速攻击期间不重算。

> **实测校准（2026-10-09，Anis: Star）**：全爆裂外两发间隔 60t；两发之间施放爆裂（蓄力固定 0.7s）→ 该发 ≈42t；两发之间爆裂效果过期 → 该发 60t。修正前引擎在排定时一次性固定发间，固定蓄力的生效/过期要到下一发才体现。

### 4.4 非蓄力武器射击节奏（rate_of_fire 累加器）

适用 AR / SMG / MG / SG（`chargeTimeTicks = 0` 且 CDN `rate_of_fire > 0`）。

**累加器模型**：每 tick `shotAccumulator += rof / 60 / TICK_RATE`（RPM → 发/tick），`shotsThisTick = floor(shotAccumulator)`，发射后扣除整数部分（保留小数，避免高 ROF 的逐 tick 取整损失）。`rof` 可被攻速 buff（`atkSpeedPct`）与 MG 起速（`mgCurrentRof`）覆盖。

**帧率封顶（每 tick 最多 1 发）**：游戏客户端按帧结算射击，每帧最多一次普通攻击，60fps 上限下每秒最多 60 发（= 3600 RPM）。`shotsPerTick` 结果封顶 `MAX_SHOTS_PER_TICK = 1`，因此 MG 顶速 4200 RPM（70 发/s）实际只打出 60 发/s；SMG 1440 RPM（24 发/s）等不受影响。2025-04 客户端加入「修正最小发射次数」后，低帧率设备按 60fps 基准补发，故封顶值与设备实际帧率无关。

> **实测校准（2026-10-09）**：Rapi: Red Hood（弹匣 913，Resilience 魔方）3 分钟普攻 9101 次（按弹药计数器逐弹匣统计）。换弹几乎瞬时（Crown 爆裂换弹速度）的连续弹匣仍需 ≈16s 打空（≈57–60 发/s），隐藏后首个弹匣 ≈17–18s（含 1s 首发等待 + 起速）；封顶前引擎按 70 发/s 分别跑出 13.0s / 14.6s，全场 10807 次，偏多 18.7%；封顶后 15.2s / 16.7s，全场 9394 次，偏多 3.2%（剩余偏差与实测弹匣耗时一致地约 5%，推测为设备实际帧率略低于 60，未建模）。逐弹匣实测明细见 dev/game-data.md「Rapi: Red Hood（MG，帧率封顶）」。

**开局对准后立即击发**：`shotAccumulator` 初值为 **1**（而非 0），首发不必空等一个完整射击间隔；但非蓄力武器开局须先经 `spot_first_delay` 对准期（`aimReadyTick` 初值 = `reloadAimTicks`，与换弹后对准期同一值，同蓄力武器首发含前摇），首发 @`reloadAimTicks`。无 CDN 数据时 `reloadAimTicks = 0`，仍在 tick 1 立即击发。

> **实测（2026-10-12，Tove AR 720 RPM，`spot_first_delay` 33 cs = 20 t）**：计时器启动起第 2/3 发 @22/28 帧；模型第 2/3 发 @24/29（开局立即击发模型为 @5/10）。第一次开始装填实测 8.1s，模型末发 7.73s + 后摇 0.2s = 7.93s。详见 dev/game-data.md「非蓄力武器开局对准期」。
> **实测（2026-10-12，Privaty: Unkind Maid / Brid: Silent Track，SG 90 RPM，对准 12 t，弹匣 9，两人动作完全一致）**：首发约第 10 帧（模型 @12），打完第 9 发约 5.5s = 330 帧（模型 @331）。下方 Brid 旧标定「第 9 发 @322t」系开局立即击发模型下的拟合，已被本实测取代。
> 各例实测首发均比模型早约 2 帧（Tove 2–3、Privaty 2、Anis: Star 2），疑为计时器启动略晚于战斗逻辑，未建模。

> **历史偏差（已修复）**：此前累加器从 0 起，每个弹匣首发都要多等一个完整间隔（如 Brid: Silent Track 90 RPM ＝ 0.667s），开局与每次换弹后各损失约一个间隔，导致整体射击数偏低、战斗偏慢。实测帧数据校准（Brid 首弹匣第 9 发 @322t、换弹完成 @396t）后，修正模型误差 ≤3 tick。（该标定未含开局对准期，2026-10-12 已由 Privaty / Brid 实测「第 9 发 ≈330 帧」取代，见上。）

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
- `mgCurrentRof` 仍按 CDN 数值升到 `end_rate_of_fire`（4200），但实际发数受 §4.4 帧率封顶约束：达到 3600 RPM（36 发）后即为 1 发/tick，之后的起速不再增加射速。

### 4.6 SG 弹丸

- `shotCount`：每次射击的弹丸数（来自 `shot_detail.shot_count`）。
- `shot_detail.damage` 为所有弹丸合计伤害（`hitMultiplier` 已含合计）。
- 弹丸数变化**不影响**整发伤害系数（全部命中时合计不变）；核心命中率按几何模型 §3.8.1 逐发判定。
- 弹丸数**不影响整发爆裂充能**：整发充能 = `target_burst_energy_pershot × 基础 shot_count`（全部弹丸命中时），每颗弹丸充能 = 整发充能 / 发射弹丸数，按命中比例折算，详见 §6.1。
- **躯体命中（实战命中校正，模拟选项「SG弹丸命中率」`sgHitRate`）**：每颗弹丸独立判定是否命中躯体，伤害按命中弹丸比例缩放（`hitMult × 命中数 / 发射数`），充能与技能弹丸计数（`ctx.pellets`）按命中数。命中概率（`battle-utils.js:sgPelletHitRate`）：
  - `sgHitRate` 为敌人距离 50、散布 250、HitRate 0 时的标定值；先按距离线性缩放（`distanceScaledHitRate`，d=0 恒为 1）。
  - 打空率再乘 `min(1, R_eff / 250)`，`R_eff = currentScale / (1 + 4.5 · HitRate)`（与 §3.8.1 同一收圆式）：散布收束（如 Privaty: Unkind Maid 250→75）或命中率 ▲（如 Dorothy: Serendipity Flash +98%）时弹丸更集中、打空更少。武器切换取 `weaponSwitchAccuracyScale`，缺失按标定散布。
  - 引擎默认 `sgHitRate = 1`（恒命中，回归测试依赖），界面默认 0.7。
  - 修正前「弹丸数固定为 1」的 Flash 射击按 0.7 整发打空（18% 的 Flash 伤害为 0），Dorothy: Serendipity 低于实测约 10%。
- **【TODO 可选】SG 逐弹丸核心拆分**：当前 SG 每次射击按单次 `P_core` 判定整发核心与否（期望 DPS 与逐弹丸 k/N 拆分**数学等价**，蒙特卡洛均值一致）；逐弹丸拆分仅降低方差、细化日志 isCore 标记，为低优先级细化项。

### 4.6.1 双枪（`shot_detail.muzzle_count === 2`）

- 判定：CDN `shot_detail.muzzle_count === 2`（`initBattle` 写入 `unit.dualGunMult = DUAL_GUN_MULT = 2`，cfg 可用 `dualGunMult` 覆盖）。
- 实机效果：SMG / RL 每次射击造成 2 次伤害；SG 弹丸数不变、每颗弹丸伤害翻倍（即武器伤害系数翻倍）。
- 引擎统一按**武器伤害系数 ×2** 结算（`hitMult = 基础系数 × dualGunMult`）：SG 每弹丸系数随之 ×2，弹丸数与爆裂充能不变；
  命中次数仍计 1 次（`hitCount`、按命中次数触发的技能不翻倍）。
- **切换武器默认同样 ×2**；技能已用其他方式体现双枪时设 `skillState.weaponSwitchDualGun = false` 排除
  （如 Zwei 爆裂的双重命中 `weaponSwitchDoubleHit`）。
- 日志：命中行记录 `dualGunMult`，伤害明细「伤害系数」段拆为「基础系数」+「双枪 ×2」；公式导出为 `weaponDmg`（基础系数）+ `dualGun` 系数项。
- 双枪角色：K (41)、Zwei (390)（已核对）；Quency: Escape Queen (403)（TODO 未审核）；
  Crow (110)、Soline (71)、Quency (402)、Aigis (872)、Noah (232)（未建模，建模时按本节核对）。
- 回归测试：`test-dual-gun.mjs`。

### 4.7 武器切换（WEAPON_SWITCH 效果）

- 期间覆盖 `hitMult`、`weaponType`（可选）、是否蓄力；双枪角色切换武器默认同样 ×2（§4.6.1）。
- 支持时间制（`seconds`）和回合制（`endRounds`，每发消耗 1 回合）。
- 期间可选无限装弹（`unlimitedAmmo: true`）。
- 切换结束后可有 `backswingTicks` 的封锁期（`weaponSwitchPostBackswingEndTick`）。
- 切换武器后，当前武器弹匣默认为满弹；若有技能在切换时显式设定弹药数，则以技能值为准。
- 可选覆盖：`weaponSwitchCoreRate`（切换武器核心率，缺省按切换武器类型硬编码，见 §3.8）；`weaponSwitchLabel`（命中统计/日志标签，缺省为 `Burst <爆裂技能名>`，切换来源为 S1/S2 时应显式指定，如 Drake: Great Villain S1）；`weaponSwitchRateOfFire`（切换武器射速 RPM，仅对非蓄力累加器模型生效，缺省沿用原武器 `rate_of_fire`；如 Moran 爆裂 1440 RPM，数据来自 nikke.gg，未实测验证）；`weaponSwitchAmmoCountPerShot`（「Expends ammo. Amount: N round(s)」：每发按 N 发计入全队累计消耗弹药 `totalAmmoFired`（S1 P5 一类「累计消耗弹药」计数），弹匣实际仍只扣 1 发；如 Cinderella: Crystal Wave Snipe Mode 全蓄力 = 40 发）。
- **非蓄力武器切换为蓄力型武器**（`weaponSwitchChargeTimeTicks > 0` 且原武器 `chargeTimeTicks = 0`，如 Cinderella: Crystal Wave MG → Snipe Mode）：换弹完成后仍经原武器的对准期 `reloadAimTicks`，之后由技能 `RELOAD_END` 触发器排定 `chargeTick = 换弹完成 + 对准期 + 切换武器蓄力`；HIDDEN 退出时重置为 `now + 切换武器蓄力`。
- **切换武器自带基础弹匣**（如 Snipe Mode 15 发）：技能改写 `unit.baseAmmo` 后调用 `recalcMaxAmmo`，装备词条（百分比 buff）按新基础自动生效，珍藏品装弹数 flat（引擎按原武器基础预折）由技能按同一百分比重算；`weaponSwitchMaxAmmo = null` 使日志弹匣上限跟随 `unit.maxAmmo`。

#### 4.7.1 Cinderella: Crystal Wave 形态切换（Preparation for Change / Snipe Mode）

- 任意装填到满弹 → **Preparation for Change**（6s，`skillState.fixedReloadTicks = 180` + `fixedReloadEndTick`，换弹时长固定 3s、忽略换弹速度，见 §5.2），打出末弹时移除。
- Preparation for Change 期间再次装填到满弹 → 切换 **Snipe Mode**（`'SR'` 型武器切换：固定蓄力 1s、62.13% ATK、全蓄力 250%、Pierce；弹匣以 15 发为基础重算装备词条 / 珍藏品 / 魔方等装弹数效果，每发实际扣 1 发；「全蓄力 Expends ammo 40 发」仅按 40 发计入累计消耗弹药）；再次满足则切回 MG。Snipe Mode 弹匣耗时远超 6s，末弹移除 Preparation for Change，因此其后的装填不再触发切换。距离优势仍按原武器 MG 判定。
- 形态变化派发 `SNIPE_MODE_CHANGED`（ctx.active），S2 据此互换 Destroy / Pinpoint；S2 P5 两分支（Snipe Mode 全体伤害 / 非 Snipe Mode 核心打击）互斥，统一标签 `S2 P5`（显示「Mode Swap P5」）。
- **未建模 / 存疑**：Snipe Mode 普攻的爆裂充能沿用 MG 每发 `target_burst_energy_pershot`（1000），切换武器真实充能值无数据；核心倍率沿用 MG `core_damage_rate`（×2）。
- 自动战斗不主动装填 → 默认恒为 MG。UI 选项「进入战斗时切换到 Snipe Mode」（`config.ccwSnipeModeAtStart`）按手动打法模拟：进入 Snipe Mode 之前每发射击后立即主动装填（弹匣置 0，下一 tick 走常规换弹流程，不触发 `LAST_BULLET`）。无换弹速度 / 装弹数加成时：MG 首发 @60t → 装填 1 + 150 + 12 → PfC → 对准 12 + 起速首发 60 → 装填 1 + 180 + 12 → Snipe Mode → 首发 +12 + 60；此后弹匣内每 60t 一发，打空后装填 1 + 150 + 12、对准 12、蓄力 60 再续。回归测试：`test-crystal-wave.mjs`。

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
   限时的「Reloading Speed is fixed at X% for N sec」另设 `skillState.fixedReloadSpeedEndTick`，到期后自动失效（Jill 爆裂、Exia SSR S1 P2）。
   **固定换弹时长**：`skillState.fixedReloadTicks` 在 `fixedReloadEndTick >= tick` 期间直接作为折减后装填时长（忽略基础时长与换弹速度；「Reload time is fixed at X sec」，如 Cinderella: Crystal Wave 的 Preparation for Change 3s），末发后摇 `reloadRecoveryTicks` 仍照常追加。
3. 装填时长：`Math.round(reloadTicks × Math.max(0, 1 − effectiveReloadSpeed)) + reloadRecoveryTicks`。
   - **折减部分**：乘法折减（非除以 `1 + speed`）；换弹速度 ≥100% 时为 0（瞬间装填）。例：基础 2s、换弹速度 +29.69% → `120 × 0.7031 ≈ 84 tick ≈ 1.41s`。
   - **DOWN_Charge 型蓄力武器**：换弹不重置也不覆盖末发后摇与再次按下的前摇，三者串联；换弹后首发 = `换弹完成 + 后摇 + 前摇 + 蓄力`（§4.3.6）。实测（2026-10-09）：Anis: Star 换弹速度 114% 时 66t = 0 + 12 + 12 + 42，74% 时 96t ≈ 31 + 12 + 12 + 42。
   - **`reloadRecoveryTicks`（末发后摇）**：非蓄力武器的 CDN `spot_last_delay`（`maintain_fire_stance > 0` 时覆盖），**不受换弹速度折减**；蓄力武器为 0。例：Brid: Silent Track 基础 1.5s、换弹速度 +29.69%、后摇 0.2s → `90 × 0.7031 + 12 ＝ 63 + 12 ＝ 75 tick ≈ 1.25s`。
   - **`reloadAimTicks`（换弹后对准期）**：非蓄力武器换弹完成（装填事件、`RELOAD_END`）之后再等 CDN `spot_first_delay`（通常 12 t）才恢复射击；期间射击累加器按当前 RPM 继续累积（封顶 1）、MG 射速继续衰减，故 MG 衰减不深时对准结束立即击发。实测（2026-10-09，Rapi: Red Hood）：换弹速度 114%（换弹 0 t）弹匣打空到首发 **23 t** ≈ 12 + 12；84%（无魔方，换弹 2.5s × 0.156 = 23 t）**48 t** = 23 + 12 + 12。与 DOWN_Charge 型（§4.3.6）同一规则：换弹动作不重置也不覆盖前后摇。
   - **UP 型蓄力武器**：后摇不是串联相加，而是与换弹**同时计时**，换弹相位 ＝ `max(backswingTicks, 折减后装填时长)`，从末发射击 tick 起算（§4.3.6）。此外，UP 型每次攻击后的后摇期间都会尝试换弹，后摇结束时打断；换弹时长 ≤ 后摇时可在后摇中补满，并记录装填事件（§4.3.9）。
4. **装填完成时**计算本次应恢复的弹药量（不在装填开始时计算）：
   - 分段装填（`reloadFraction < 1`）：`Math.min(effectiveMax, Math.round(maxAmmo × reloadFraction))`。
   - 默认一次装满：`effectiveMax`。
5. `effectiveMax` 即 `unit.maxAmmo`（已含所有 buff 和技能效果的缓存值，由 5.1.2 的时机维护）。
6. **装填完成后衔接射击周期**：非蓄力 RPM 武器先经 `reloadAimTicks` 对准期（§5.2），期间保留并继续累积 `shotAccumulator`（封顶 1；装填 + 对准 ≥ 发间时已到 1 → 对准结束立即击发，否则下一发落在「上一发 + RPM 发间」，见 §4.4）；MG 起速武器 `shotAccumulator = 0`（重新预热）；蓄力武器 `shotAccumulator = 0` 且重置 `chargeTick`（须重新前摇＋蓄力，见 §4.3.6）。

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
- **SG 武器（整发充能固定，按命中弹丸比例折算）：** 整发充能 = `targetBurstEnergyPerShot × 基础 shotCount`，为【全部弹丸命中】时的充能（如 Brid: Silent Track 4000 × 10 = 每次射击 40000）。弹丸数 ▲ / 「弹丸数固定为 N」**不改变**整发充能（同伤害系数口径），每颗弹丸充能 = 整发充能 / 发射弹丸数，动态计算；本次射击充能 = 整发充能 × 命中弹丸数 / 发射弹丸数（四舍五入）。命中弹丸数见 §4.6 SG 弹丸命中判定（引擎默认全部命中）。
- buff 的 `burstGaugeFlat` 加成：叠加到 `baseEnergy`（按每次射击计、不乘弹丸数），Focus 蓄力时整体再乘以全蓄力系数。
- **仅 `burstPhase === 0` 时累积**；B1–Full Burst 期间停止充能。
- Full Burst 结束后重置为 0。

### 6.2 爆裂序列状态机

```
burstPhase = 0（充能中）
  → 槽满（>= 1,000,000）
    → ENTER_BURST_I 被动触发
    → 等待 burstStepTicks（0.1–0.4s，默认 0.4s；自动战斗实测 0.4s 且为上限）
    → 等待 B1 单位冷却结束
      → B1 施放（BURST_SKILL_USE）
        → ENTER_BURST_II 被动触发
        → 等待 burstStepTicks
          → burstPhase = 2
          → 等待 B2 单位冷却结束
            → B2 施放（BURST_SKILL_USE）
              → ENTER_BURST_III 被动触发
              → 等待 burstStepTicks
                → burstPhase = 3
                → B3 施放（BURST_SKILL_USE；按 §6.0 从左到右选第一个 CD 就绪的单位；其余 B3 本轮无法施放）
                  B3 施放者爆裂技能的伤害全部排入 pendingSkillHits 并后移 0.05s：技能延迟从进入全爆裂起算，
                  即时命中在进入全爆裂那一 tick（先于 ENTER_FULL_BURST）结算
                → 固定等待 0.05s（FULL_BURST_ENTRY_DELAY_TICKS = 3 tick；2026-10-12 实测，更正原 0.4s / 0.1s；
                  无法通过操作缩短，不随 burstStepSecs 变化）
                → ENTER_FULL_BURST 被动触发 → fullBurstActive = true（默认 10s 窗口；「Full Burst Time ▼ N sec」
                  由技能写入 state.fullBurstTimeReductionTicks，进入全爆裂时扣减并清零，如 Isabel 爆裂 −5s）
                → 受全爆裂影响的 B3 伤害（affectedByFullBurst 延迟命中、pendingFireInBurstHits）捕获 sums 与 buff 明细快照
                → FULL_BURST_SNAPSHOT 触发
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
> 结果：直接伤害类 B3 爆裂技能在进入全爆裂后结算，由引擎自动标记 `suppressFullBurst` 屏蔽 +50% 补正；技能文件无需额外标记（`affectedByFullBurst` 例外见 3.2）。

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
| `normalAttackDamagePct` | 普通攻击伤害%（ExtraMultiplier 加法） |
| `normalAttackDamageMultPct` | 技能 "Normal Attack Damage Multiplier ▲/▼"：与珍藏品普攻倍率相加后乘在 BaseDamage 上（favNormalAttackDamageMult = 1 + 珍藏品 + Σ本字段）；技能产生的普攻命中（`isNormalAttack`）同样适用（基数 1，不含珍藏品） |
| `critRatePct` | 暴击率加成 |
| `normalAttackCritRatePct` | 普通攻击暴击率加成（不区分蓄力） |
| `critDamagePct` | 暴击伤害加成（增量） |
| `chargeDamagePct` | 蓄力伤害加成（加到 chargeMult） |
| `chargeDamageMultPct` | 技能 "Charge Damage Multiplier ▲"：与珍藏品蓄力倍率相加后乘武器基础蓄力（chargeMult = 基础×(1+珍藏品+Σ本字段) + 加法项） |
| `chargeSpeedPct` | 蓄力速度% |
| `reloadSpeedPct` | 换弹速度% |
| `maxAmmoFlat` | 弹匣容量固定加成（到期时同样截断当前弹药，与 `maxAmmoPct` 行为一致） |
| `maxAmmoPct` | 弹匣容量百分比加成（到期时截断当前弹药） |
| `burstGaugeFlat` | 每发充能固定加成 |
| `enemyDamageTakenPct` | 敌方承伤 debuff（`unitId: '__enemy__'` 的 buff，按层数汇总） |
| `atkSpeedPct` | 攻击速度%（影响 RPM） |
| `lifeStealPct` | 生命偷取% |
| `pierceDamagePct` | 穿透伤害% |
| `distributedDamagePct` | 分摊伤害% |
| `sustainedDamagePct` | 持续伤害%（原名 `sustainedDamageMult`，已重命名） |
| `allEnemiesBurstDamagePct` | 「全体敌人」爆裂技能伤害%（ExtraMultiplier 加法；仅施放者爆裂描述中「Affects all enemies」段的伤害命中，见 `isAllEnemiesBurstHit`） |
| `normalAttackTrueDamage` | 布尔标记：普通攻击（含武器切换射击）造成真实伤害——无视防御并计入 `trueDamagePct`（如 Guilty/Sin Bunny Mode: Engage） |
| `stackLimit` | 叠加上限（默认 1；大于 1 时为可叠加效果，见 7.2） |
| `isDebuff` | 是否为 debuff（影响免疫与驱散机制，见 7.3） |
| `multiplier` | 数值已按动态倍率 n 放大时记录 n（如 Drunken 层数）；伤害公式明细显示「名称 *n」，不参与计算 |

`pushBuff` 的目标字段：`unitId: <id>`（单体）、`unitId: null`（全队共享一条）、`unitIds: [...]`（多个指定目标：逐人独立 buff，日志合并为一行）。
`name` 的命名规范见 [skill-modeling-guide.md](skill-modeling-guide.md)。

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
| `FULL_BURST_SNAPSHOT` | ENTER_FULL_BURST 后、受全爆裂影响的 B3 伤害快照完成之后（「先计入快照、再移除」的效果） | 团队 |
| `FULL_BURST_END` | Full Burst 10s 窗口结束 | 团队 |
| `SHOT_COUNT` | 本单位每 N 发普攻 | 非团队（溢出保留） |
| `SQUAD_SHOT_COUNT` | 任意单位射击时广播 | 全员（ctx.shootingUnit） |
| `LAST_BULLET` | 本单位打出最后一发 | 非团队 |
| `FULL_CHARGE` | SR/RL 全蓄力射击 | 非团队 |
| `AMMO_MILESTONE` | 全队消耗弹药累计达到 400/500 发 | 团队 |
| `INTERVAL` | 全程每 N 秒（首次在 t+Ns） | 团队/非团队 |
| `INTERVAL_IN_BURST` | 全爆裂期间每 N 秒 | 团队 |
| `HEAL_RECEIVED` | 某单位受到治疗时触发（ctx.unit = 受治疗者）；全队治疗产生 5 个独立事件，每个事件对应各自受治疗的单位 | 团队 |
| `HP_CHANGED` | 某单位当前 HP 变化后触发（ctx.unit / prevHp / newHp）；来源见 §9.1 | 团队 |
| `APPLY_SHIELD` | 某单位获得护盾时触发；全队获盾同样产生 5 个独立事件 | 非团队（仅 caster === ctx.unit 响应） |
| `COVER_HEAL_RECEIVED` | 掩体受到治疗 | 团队 |
| `CORE_HIT` | 命中敌人核心 | 非团队 |
| `RELOAD_END` | 自然装填完成 | 非团队（不含技能补弹） |
| `DURING_FULL_CHARGE` | 全蓄力击发之前（推入的 buff 作用于本次射击） | 非团队 |
| `ONE_MORE` | Persona 联动「1 More」生效于 ctx.unit（技能文件派发） | 非团队 |
| `FOLLOW_UP` | Persona 联动「Follow Up」生效于 ctx.unit（技能文件派发） | 非团队 |
| `BUNNY_MODE_CHANGED` | ctx.unit 的 Bunny Mode 形态变化后（技能文件派发） | 非团队 |
| `SNIPE_MODE_CHANGED` | ctx.unit 的 Snipe Mode 生效 / 移除后（ctx.active；`515.js` 派发） | 非团队 |

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
| `SKILL_DAMAGE` | 技能伤害（count 次，mult 倍率） |
| `HEAL` | 治疗目标（pct×maxHP 或 flat） |
| `RELOAD_AMMO` | 补充弹药（`round(maxAmmo × pct)`，补满即取消换弹；技能文件直接调用 `battle-utils.js:reloadMagazinePct`。同一技能先扩容再补弹时按扩容后上限计算。实测：Little Mermaid 33.26% 为弹匣 913 补 304 发；Tove S1 5.31% 第 10/20/30 发按扩容后上限 62/64/66 补 3/3/4 发） |
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
- B3 施放期间（`state.b3Cast`），施放者 `burst` 槽 `BURST_SKILL_USE` handler 新增的延迟命中统一 `fireTick += FULL_BURST_ENTRY_DELAY_TICKS`；
  其中的即时 `fireSkillHit` 由引擎转为延迟命中（`fireTick` = 施放 tick + 0.05s，预捕获 sums 与 buff 明细；`affectedByFullBurst` 命中则在进入全爆裂瞬间快照）。
- 兜底：`affectedByFullBurst` 命中在 B3 施放后、进入全爆裂前到期时，转入 `pendingFireInBurstHits`，在 ENTER_FULL_BURST 之后结算。
- 全爆裂瞬间快照：受全爆裂影响的 B3 伤害（`affectedByFullBurst` 延迟命中、`pendingFireInBurstHits`）不在命中时重算，
  而是在进入全爆裂瞬间（ENTER_FULL_BURST 及连带效果全部生效后）统一捕获 sums 与 buff 明细，之后按各自延迟用同一快照出伤；
  全爆裂 +50% 仍按命中时 `fullBurstActive` 判定。快照后触发 `FULL_BURST_SNAPSHOT`，供「先计入快照、再移除」的效果使用
  （Elegg: Boom and Shock S1 属性优势 buff，已实测）。

---

## 9. 治疗与护盾

### 9.1 体力治疗

- `applyHeal(state, target, amount, logCtx, caster)`：
  实际回复量 = `amount × (1 + 治疗者 healPotencyPct) × (1 + 受治疗者 incomingHealPct)`，
  `unitHp = min(最终 MaxHP, unitHp + 实际回复量)`。`caster` 省略时不计治疗效能。
- 治疗后将 target 推入 `pendingHealReceived` 队列。
- `flushHealReceived()` 去重后逐单位触发 `HEAL_RECEIVED`。
- **生命偷取** `applyLifeSteal(state, unit, damage, sums)`：普通攻击与技能命中后按 `sums.lifeStealPct` 回复自身，
  同样计入治疗效能 / 受治疗量并派发 `HEAL_RECEIVED`（如 Helm 爆裂全员生命偷取可触发 Crown S2 P3）。不写战斗日志。
- **HP 扣减** `applyHpLoss(state, unit, amount)`：「Current HP ▼ X%」类自损（Scarlet S1、Grave 爆裂），
  按最终 MaxHP 换算，HP 下限 1。
- **HP 比例** `getHpRatio(state, unit)` = `unitHp / 最终 MaxHP`（不含溢出储存池），「HP 低于 / 高于 X%」类条件统一用它判定。
- **HP_CHANGED 事件**：当前 HP 或最终 MaxHP 任一变化即派发。所有写 HP 的路径（治疗、生命偷取、截断、`applyHpLoss`、
  将来的受伤）与所有改变最终 MaxHP 的路径（Max HP buff 推入 / 叠层 / `setMaxHpBuffValue` / 到期 / 技能主动移除）
  都在变化**之前**把 `{ prevHp, prevMaxHp }` 记入 `state.pendingHpChanged`，由 `flushHpEvents` → `dispatchHpChanged`
  派发团队触发 `HP_CHANGED`（ctx.unit / prevHp / newHp / prevRatio / newRatio；同一 flush 周期合并，取首次变化前的值；
  handler 内再改 HP 则进入下一轮，最多 8 轮）。技能文件直接删除 / 减层带 Max HP 的 buff 时须先调用 `markMaxHpChange`；
  buff 到期时 `getBuffSums` 已排除该 buff，battle.js 以 `beforeTick: tick − 1` 计算变化前 MaxHP。
  HP 条件类技能一律响应此事件：Scarlet S2 P2、Alice S2、Moran S2 P2、Noir S1（自身 HP 比例）；
  Soline S2、Centi S1 P4、Flora S2 P1（任意 / 相邻友军 HP **比例下降**跨过阈值，`newRatio < prevRatio`：
  自损或 Max HP ▲ 均可触发，治疗不会连锁触发。实测 Trina S2 P1 给相邻 Scarlet 加 Max HP 会触发 Flora S2 P1；
  游戏内该检测约有 ≤0.1s 延迟，未建模）；
  Flora S2 P2（相邻友军满 HP：进入战斗时检查一次，此后仅在相邻友军**当前 HP** 变化时检查（`newHp !== prevHp`）——
  始终满 HP 时受治疗 HP 不变，不触发）。
- 攻击循环前后各兜底 `flushHpEvents` + `flushShieldReceived` 一次（开战后同样），确保 ENTER_BURST_II 等未随即 flush 的
  Max HP 变化及其连带护盾（APPLY_SHIELD）在同一 tick 内派发。
- **溢出治疗储存** `applyOverhealStorage(state, target, cap, endTick)`（Centi S1 P3 Stockpile / Anchor 爆裂 Storage）：
  生效期内超出最终 MaxHP 的治疗存入 `unit.overheal.hp`（上限 cap），`applyHpLoss` 先扣储存池再扣 HP，
  到期 `expireOverheal` 移除储存部分；储存池不计入 HP 比例。
- **平均分摊治疗**（buff 字段 `shareHeal: true`，Nayuta S1 P2 Hypocrisy）：目标受到的实际回复量均分给全队，
  只有原目标视为「受到治疗」（HEAL_RECEIVED），其余队员仅发生 HP 变化（HP_CHANGED）。
- **「n 名最低 XX 的队友」** 的筛选用稳定排序：判定值相同时按站位从左到右（如 Liter S2 掩体 HP 不建模 → 恒取最左 n 名）。
- **同一时机多名角色的技能结算顺序 = 站位从左到右**（`executeSkillTriggers` 按 `state.squad` 遍历施放者，
  `priority` 稳定排序在其上）。实测：Flora / Trina 开战效果谁先结算只取决于左右位置，与角色编号无关。
- **站位与空位**：单位带 `position`（0–4，队伍槽位序号，含空位）；空位不进入 `state.squad`，但占据位置。
  「相邻 / 两侧」一律用 `getAdjacentAllies`（隔着空位不相邻，实测 Trina, 空, Flora 时二者不相邻），
  前后排等位置判定用 `getUnitPosition`，不要用 `state.squad` 下标。

### 9.1.1 Max HP 变化与当前 HP

- 开战时 `unitHp = 最终 MaxHP`（含 Vigor 方块等永久 buff）。
- **游戏基础机制：Max HP 变化只改变上限，不按比例保持当前 HP**（与描述是否写「without restoring HP」无关）。
  - Max HP ▲（`pushBuff` 推入含 `maxHpPct` / `maxHpFlat` 的 buff、叠层 +1、数值提升）：当前 HP 不变，
    满 HP 时获得提升会变为不满 HP。
  - Max HP ▼（buff 到期、层数减少、数值降低、技能主动移除）：当前 HP 高于新上限时由 `clampHpToMax` 截断，否则不变。
    buff 自然到期由 battle.js 过期清理统一截断；技能文件主动删除 / 减层带 Max HP 的 buff 后须自行调用 `clampHpToMax`。
- 就地改写已有 buff 的 Max HP 数值须用 `setMaxHpBuffValue(state, buff, { maxHpPct, maxHpFlat })`（内含截断）。

### 9.2 HoT（持续治疗）

- 推入 `pendingHoTs`：`{ fireTick, targetId, amount, casterId }`，`amount` 为基础量。
- 每 tick 处理到期条目，以 `casterId` 对应单位为治疗者调用 `applyHeal`（按触发时刻的治疗效能计算）并 flush；
  **会触发 `HEAL_RECEIVED` 事件**，与直接治疗行为一致。

### 9.3 护盾

- `applyShield(state, unit, shieldAmt, shieldEndTick)`。
- 刷新语义：已有护盾时取两者较大值（量与到期 tick 均取 max）。
- 过期护盾在每 tick 开头清理。
- **当前未建模**：护盾仅存储，未参与 HP 扣减计算（HP 直接受伤不经护盾）。
- **共享护盾（shared shield）**：`applySharedShield(state, shieldAmt, shieldEndTick)`，如 Centi S2。
  单一护盾池存于 `state.sharedShieldHp / sharedShieldEndTick`，不写入任何单位的 `shieldHp`，
  **不派发 `APPLY_SHIELD`**（「when applying Shield」类技能如 Naga S1 P2 不响应），
  「自身持有生效护盾」条件（如 Naga 爆裂 P3）也不计入。刷新与过期语义同 `applyShield`。

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
| `enemyCoreProtected` / `enemyCoreIsParts` | 核心状态标志（保护核心 / 零件核心），见 §3.8 |
| `distanceZone` | 当前距离区间（`NEAR/MID/FAR/null`） |

### 11.2 阶段调度（enemyPhases）

- 配置为 `{ startTick, zone }` 数组，按 startTick 升序。
- 支持区间（Zone）：`NEAR`（近）/ `MID`（中）/ `FAR`（远）/ `HIDDEN`（隐藏，不可瞄准）。
- `NEAR/MID/FAR` 决定 `distanceZone`，影响距离优势加成（见 §4.2）；`HIDDEN` 不更新 `distanceZone`。
- 实测阶段表（BIGARMS 模式1/模式2 等）见 `dev/game-data.md`。

#### HIDDEN（隐藏）阶段

`HIDDEN` 期间敌人**完全不可攻击**（`battle-utils.js:isEnemyHittable`），全队**无法普通攻击**：

- **自动攻击技能**（如 Anis: Star 的 Shooting Stars）：本轮无目标，跳过（计时照常推进，不顺延）。
- **带延迟的技能伤害**（`pendingSkillHits`）：到期时敌人仍隐藏 → **落空**，伤害记为 0、不触发命中效果、不充能，
  日志写入 `missed: true` 条目（`logMissedSkillHit`），界面伤害列显示红字「未命中」。
- **DoT 池、HoT** 仍正常结算。

#### 跳起（jump）行动

射击场 BIGARMS 的「隐藏」实为跃起离屏再落下，用固定时长 1.85s 的「跳起」行动建模（值 = 落地后的目标距离），
由 `enemy-config-io.js:buildEnemyPhases` 展开为三个区段：

| 时段 | 引擎区段 | 全队 | 敌人可被命中 |
|---|---|---|---|
| 0–1s 起跳 | `JUMP` | 停止攻击（与进入 HIDDEN 相同：停火、按弹匣状态装弹 / 待命） | 是（已打出的技能、延迟命中照常命中） |
| 1–1.7s 空中、1.7–1.85s 落地 | `HIDDEN` | 停止攻击（JUMP → HIDDEN 不重复执行进入逻辑） | 否（延迟命中落空；DoT 照常） |
| 1.85s | 目标距离 | 恢复攻击（同 HIDDEN 退出：恢复被打断的装填、蓄力重置） | 是 |

原「隐藏」行动保留，用于瞬间隐藏的实战 BOSS（隐藏时段内完全不可攻击）。实测记录见 `dev/game-data.md`。

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

**实现方式（`hitPart` 参数）：** 普通攻击与技能伤害计算均通过 `hitPart`（`'body'` | `'core'` | `'parts'` | `'intercept_parts'`）标识命中部位，默认为 `'body'`（本体）。`damageToPartsPct` buff 仅在 `hitPart === 'parts'` 时计入 `ExtraMultiplier`；例外：「零件核心」敌人（Ultra / Material H / Storm Bringer）的核心命中（`hitPart === 'core'` 且 `coreIsParts`）同时算核心命中与零件命中，两类加成与触发均生效（§3.8.2）。技能文件中，"零件伤害增加"效果应建模为 `damageToPartsPct`（而非 `attackDamagePct`）。普通攻击不产生 `hitPart === 'parts'` 的命中（§11.3.1），该加成仅对零件核心敌人的核心命中生效，但建模正确，不再错误叠加到本体/核心命中。

> 当前模拟器中，阻止部位未建模，含有"阻止部位伤害增加"的技能效果暂时忽略。

#### 11.3.1 零件机制

游戏内零件的机制：

1. **独立血量**：每个零件拥有独立于本体的血量。
2. **摧毁零件可阻止特定攻击**：摧毁零件会使敌人无法使用某些类型的攻击。通常在敌人使用这类特别攻击之前，会留出一段时间让玩家尝试摧毁对应零件。
3. **摧毁零件对本体造成伤害**：零件被摧毁时会给本体造成一定量的伤害，数值因零件种类而异。

**模拟器的处理：** 零件血量目前难以估算，因此普通零件**不参与伤害计算**——不模拟零件命中、零件血量、摧毁零件的本体伤害与攻击阻止效果。只有特殊的**零件核心**目标（§3.8.2）才涉及零件相关的伤害计算，且这类目标的零件血量视为**无限**（永不被摧毁）。

因此敌人配置中不提供「命中零件」状态；"零件伤害增加"与以"命中零件"为条件的触发效果，仅在敌人核心状态为「零件核心」且命中核心时生效。

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
| 掩体 HP | 仅建模事件，不追踪掩体数值（「最低掩体 HP」目标按站位从左到右） |
| 「被攻击时」触发类效果 | 低优先级开发计划：Neon: Vision Eye S1 Healthy Body、Sugar S1 P1（掩体被攻击）、Scarlet S2 P1（30% 反击）；需先引入敌方伤害模型（受伤同样应派发 HP_CHANGED） |
| 普通零件（Parts）| 未建模（§11.3.1）：零件血量难以估算，零件命中、摧毁零件的本体伤害与攻击阻止、爆炸对零件+本体各结算一次均不模拟。`hitPart='parts'` 仅保留为伤害公式与技能命中的参数 |
| 零件核心（Parts Core）| ✅ 已建模（§3.8.2）：Ultra / Material H / Storm Bringer 专用 |
| 阻止部位（Intercept Parts）命中 | 未建模；含"阻止部位伤害增加"的技能效果暂时忽略 |
