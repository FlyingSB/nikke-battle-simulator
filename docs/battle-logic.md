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
| 4 | 羁绊等级 | 固定加值 |
| 5 | T10 装备（每槽 × 强化倍率） | `Math.round(base × (1 + 0.1×level))` |
| 6 | 和谐魔方固定属性 | 按魔方等级索引 |
| 7 | 收藏品固定属性 | 按物品等级索引 |
| 8 | 研究加成 | 职业 × 阵营研究等级 |
| 9 | 装备词条（均为百分比加成） | 游戏内所有实装装备词条均为百分比加成（含 ATK%）；代码中存在的固定值词条类型（如 `atkFlat`）在游戏中未出现，应忽略 |

### 特殊处理

- **装备词条 atkPct**（"Increase ATK %"）：不计入 `stats.atk`，单独存为 `equipAtkPct`，与技能 ATK% buff **加法**叠加后一起乘。
- **critRate**：基础 0.15 + 装备 critRatePct。
- **critDmg**：基础 0.50 + 装备 critDmgPct（传入 `calcDamage` 的 `critDmgIncrement`）。
- **chargeSpeedPct**：装备词条 + 魔方 Adjutant 被动之和。
- **reloadSpeedPct**：仅来自魔方（Resilience Quick Reload HC），不叠加装备词条。
- **elementDmgPct**：装备词条 + 魔方 Anti Code HC 之和。
- **bonusAmmo（装备词条弹药）**：使用 grouped-ROUND 规则 —— 相同 pct 词条分组，每组 `Math.round(baseAmmo × pct × count)`，OL 最多 4 槽。

---

## 3. 伤害公式

```
FinalDamage = BaseDamage
            × CommonMultiplier
            × ElementMultiplier        （仅属性克制时，否则 ×1）
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
- `favNormalAttackDamageMult`：收藏品 "Normal Attack Damage ▲"（SMG/SG 收藏品），直接乘在 BaseDamage 上，是**独立乘法**，与 ExtraMultiplier 不相加；**仅加成于该收藏品对应武器类型的普通攻击**（SMG 收藏品仅加成 SMG 普攻，SG 收藏品仅加成 SG 普攻）。
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

- 属性克制关系：Fire > Wind > Iron > Electric > Water > Fire（循环）。
- 当 attacker 的属性克制 defender 时：`ElementMult = 1 + 0.10 + elementAdvantageDmgIncrement`。
- 否则：`ElementMult = 1.0`（无减伤惩罚）。

### 3.4 ChargeDamageMultiplier（当前武器 isCharged=true 时）

```
ChargeMult = (fullChargeDamage / 10000) × (1 + favChargeDmgPct) + (chargeDmgStat - 1)
```

- `fullChargeDamage`：来自 `shot_detail.full_charge_damage`（10000 = ×1.0 基线）。
- `favChargeDmgPct`：收藏品 "Charge Damage ▲"，仅与 `shot_detail.damage` 相乘（独立项）。
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
| 普通攻击伤害% | `normalAttackDamagePct` | 仅普通攻击 |
| 子弹爆炸伤害% | `projectileExplosionDamagePct` | 仅 RL 普攻或标记了 projectileExplosion 的技能命中 |
| 穿透伤害% | `pierceDamagePct` | 仅穿透命中 |
| 持续伤害% | `sustainedDamagePct` | 仅 DoT |
| 真实伤害% | `trueDamagePct` | 仅 isTrueDamage 命中 |
| 其他类型 | `damageToPartsMult` 等 | 各自对应场景 |

所有加成为**加法叠加**，再统一 +1 作为乘法项。

### 3.6 DamageTakenLikeMultiplier

```
DamageTakenMult = 1 + enemyDamageTakenPct + distributedDamagePct
```

- `enemyDamageTakenPct`：对敌 debuff（"Damage Taken ▲"）的累加器，全局共享。
- `distributedDamagePct`：分摊伤害加成（特定技能），与 `enemyDamageTakenPct` 同属承伤类乘法项。

### 3.7 暴击判定

- 普通攻击有效暴击率 = `min(1, stats.critRate + sums.critRateBonus + sums.normalAttackCritRateBonus)`。
  - `normalAttackCritRateBonus`：游戏内"普通攻击暴击率"加成，**不区分蓄力与否**，仅适用于普通攻击（不含技能伤害或爆裂技能）。
- 爆裂技能命中暴击率 = `min(1, stats.critRate + sums.critRateBonus)`（不含 normalAttackCritRateBonus）。

### 3.8 核心命中判定

敌人核心有三种状态：
- **无核心**：`state.enemyHasCore = false`，不进行核心命中判定。
- **有核心（未保护）**：核心暴露，按命中率正常判定。
- **核心被保护**：核心被护甲遮蔽，普通攻击无法命中核心；仅穿透攻击（`isPierce=true`）可命中核心。

命中率判定（适用于"有核心"及穿透命中保护核心两种情况）：
- 普通攻击：核心命中率 = `coreHitRateMult`（武器类型默认值见武器系统）。
- 技能命中：由 `opts.isCore` 显式指定（通常为 false，除非技能说明"命中核心"）。

### 3.9 全爆裂补正规则

- `fullBurstActive` 由 `ENTER_FULL_BURST` 触发后置为 `true`，在全爆裂窗口内持续有效。
- **直接伤害类 B3 爆裂技能**：结算顺序在 `ENTER_FULL_BURST` 之前，此时 `fullBurstActive` 尚未为 `true`，自然不受 +50% 补正。
- **普通攻击命中**（全爆裂激活后）：受 +50% 补正。
- **延迟命中**（`pendingSkillHits`）：引擎自动打 `suppressFullBurst=true` 标记，**不受**全爆裂补正。
- 例外：显式标记 `opts.affectedByFullBurst=true` 的技能命中**受**全爆裂补正（如 Rapi: Red Hood）。

---

## 4. 武器系统

### 4.1 武器类型与基础参数

| 武器 | 射速（概率门/tick）| 默认装填（tick） | 距离优势 | 核心命中率 |
|------|-------------------|-----------------|----------|-----------|
| AR   | 0.10（~6发/秒）   | 120（2秒）       | MID      | 1.0（必中） |
| SMG  | 0.165（~10发/秒） | 120             | NEAR     | 0.033 |
| SR   | 0.025（蓄力模式）  | 90（1.5秒）      | FAR      | 1.0（必中） |
| MG   | 0.135（~8发/秒）  | 180（3秒）       | MID      | 1.0（必中） |
| SG   | 0.05（~3发/秒）   | 150（2.5秒）     | NEAR     | 0.20（固定，待建模）|
| RL   | 0.025（蓄力模式）  | 180（3秒）       | —        | 1.0（必中） |

> **注**：有 CDN `rate_of_fire` 的单位使用精确 RPM 累加器模型（非概率门）。
> MG 起速单位使用逐发 ramp-up 模型（`mgCurrentRof` 动态变化）。

### 4.2 距离优势（+30%）

| 区间 | 受益武器 |
|------|---------|
| NEAR | SG, SMG |
| MID  | AR, MG  |
| FAR  | SR      |
| RL   | 无距离优势 |

### 4.3 SR/RL 蓄力模式

- 每次射击结束后，设置 `chargeTick = tick + backswing + foreswing + effectiveCharge`。
- 下一发须等到 `tick >= chargeTick` 才打出（确定性，非概率）。
- `chargeSpeedPct` 仅缩短**蓄力（瞄准）阶段**，不影响 fore/backswing。
- `chargeTimeTicks > 0` 的 buff：先应用 `chargeSpeedPct` 百分比缩短，再应用 `chargeTimeReductionTicks` 固定 tick 减少。
- 蓄力武器的爆裂能量：`baseEnergy × (fullChargeDamage / 10000)`（满蓄力加成）。

### 4.4 MG 起速模型

- 起始射速 = `rate_of_fire`（CDN 值，RPM）。
- 每发射击后：`mgCurrentRof += mgRofChangePerShot`，上限 `mgMaxRof`。
- 不开火时（`shotsThisTick === 0`）：`mgCurrentRof -= mgRofDecayPerTick`，下限 `mgStartRof`。

### 4.5 SG 弹丸

- `shotCount`：每次射击的弹丸数（来自 `shot_detail.shot_count`）。
- `shot_detail.damage` 为所有弹丸合计伤害（`hitMultiplier` 已含合计）。
- 弹丸数变化**不影响**伤害计算（模拟器假设 100% 命中）；核心命中率固定 0.20。

### 4.6 武器切换（WEAPON_SWITCH 效果）

- 期间覆盖 `hitMult`、`weaponType`（可选）、是否蓄力。
- 支持时间制（`seconds`）和回合制（`endRounds`，每发消耗 1 回合）。
- 期间可选无限弹药（`unlimitedAmmo: true`）。
- 切换结束后可有 `backswingTicks` 的封锁期（`weaponSwitchPostBackswingEndTick`）。
- 切换武器后，当前武器弹匣默认为满弹；若有技能在切换时显式设定弹药数，则以技能值为准。

---

## 5. 弹药与装填

### 5.1 最大弹匣计算

```
maxAmmo = baseAmmo
        + Math.round(baseAmmo × bonusAmmoPct_OL)   （装备词条，grouped-ROUND）
        + Math.round(baseAmmo × favAmmoPct)         （收藏品 ammoPct）
```

> `baseAmmo`：CDN `shot_detail` 对应的初始弹数（或武器类型默认值）。

### 5.2 装填流程

1. `ammoLeft <= 0`（且无限弹药未激活）时进入装填。
2. 有效装填速度：`fixedReloadSpeedPct`（若存在）覆盖所有其他加成；否则使用 `sums.reloadSpeedPct`。
3. 装填时长：`Math.round(reloadTicks / (1 + effectiveReloadSpeed))`。
4. 装填完成后恢复弹药：
   - 分段装填（`reloadFraction < 1`）：`Math.min(effectiveMax, Math.round(maxAmmo × reloadFraction))`。
   - 默认一次装满：`effectiveMax`。
5. `effectiveMax` 计算：
   - 若有 `maxAmmoFlat` buff（如 Liter S1）：`maxAmmo + flatBoost`。
   - 若有 `tempMaxAmmoMult`（如 SBS S2）：`Math.max(1, baseAmmo + Math.round(baseAmmo × (mult - 1))) + bonusAmmo + favAmmoBonus`。
   - 否则：`maxAmmo`。

### 5.3 Bastion 魔方（Reload Up HC）

- 每射击 N 发，立即额外补充 `Math.ceil(M)` 发弹药（上限 maxAmmo）。
- 在 `onShotFired` 之后执行（最后一发效果优先）。

### 5.4 弹药相关触发

- `LAST_BULLET`：`ammoAfterShot === 0` 时触发（最后一发打出后）。
- `RELOAD_END`：自然装填完成（`ammoLeft` 恢复至 maxAmmo）时触发。不含技能/道具直接补弹满弹匣的情况。

### 5.5 HIDDEN 阶段弹药

- 进入 HIDDEN：仍有弹药的单位保存 `ammoBeforeHidden`，将 `ammoLeft` 置 0，触发装填（下一 tick 开始）。
- 离开 HIDDEN：若装填仍在进行，恢复 `ammoBeforeHidden`，取消装填（自愿装填被打断）。
- 已在装填中的单位：装填继续不中断。

---

## 6. 爆裂槽与爆裂序列

### 6.0 爆裂通用规则

- **阶段推进由施放者决定**：绝大多数角色施放爆裂技能后将爆裂阶段推进到下一阶段；少数角色施放后重新开始当前阶段（不推进）。
- **选角顺序**：若队伍中有多个相同爆裂阶段的角色，**从左到右**依次检查其爆裂技能冷却状态，选择第一个可施放的角色。【TODO】此行为可通过设置改变。

### 6.1 共享爆裂槽

- 总量：1,000,000。
- 来源：每次普通攻击命中敌人，增加 `targetBurstEnergyPerShot`（CDN 值，已是目标命中值）。
- SR/RL 满蓄力加成：`baseEnergy × (fullChargeDamage / 10000)`。
- buff 的 `burstGaugeFlat` 加成：叠加到 `baseEnergy`，然后整体乘以满蓄力系数。
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
| `critRateBonus` | 暴击率加成 |
| `normalAttackCritRateBonus` | 普通攻击暴击率加成（不区分蓄力） |
| `critDmgBonus` | 暴击伤害加成（增量） |
| `chargeDamagePct` | 蓄力伤害加成（加到 chargeMult） |
| `chargeSpeedPct` | 蓄力速度% |
| `reloadSpeedPct` | 装填速度% |
| `maxAmmoFlat` | 弹匣容量固定加成（到期时同样截断当前弹药，与 `maxAmmoPct` 行为一致） |
| `maxAmmoPct` | 弹匣容量百分比加成（到期时截断当前弹药） |
| `burstGaugeFlat` | 每发充能固定加成 |
| `enemyDamageTakenPct` | 敌方承伤 debuff（叠加到全局累加器） |
| `atkSpeedPct` | 攻击速度%（影响 RPM） |
| `lifeStealPct` | 生命偷取% |
| `pierceDamagePct` | 穿透伤害% |
| `distributedDamagePct` | 分摊伤害% |
| `sustainedDamagePct` | 持续伤害%（原名 `sustainedDamageMult`，已重命名） |
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
| `FULL_CHARGE` | SR/RL 满蓄力射击 | 非团队 |
| `AMMO_MILESTONE` | 全队消耗弹药累计达到 400/500 发 | 团队 |
| `INTERVAL` | 全程每 N 秒（首次在 t+Ns） | 团队/非团队 |
| `INTERVAL_IN_BURST` | 全爆裂期间每 N 秒 | 团队 |
| `HEAL_RECEIVED` | 某单位受到治疗时触发（ctx.unit = 受治疗者）；全队治疗产生 5 个独立事件，每个事件对应各自受治疗的单位 | 团队 |
| `APPLY_SHIELD` | 某单位获得护盾时触发；全队获盾同样产生 5 个独立事件 | 非团队（仅 caster === ctx.unit 响应） |
| `COVER_HEAL_RECEIVED` | 掩体受到治疗 | 团队 |
| `CORE_HIT` | 命中敌人核心 | 非团队 |
| `RELOAD_END` | 自然装填完成 | 非团队（不含技能补弹） |

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

### 9.1 HP 治疗

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

---

## 11. 敌人系统

### 11.1 敌人参数

| 参数 | 含义 |
|------|------|
| `enemyDef` | 防御值（固定，参与 BaseDamage 计算） |
| `enemyElement` | 敌人属性（影响属性克制判断） |
| `enemyHasCore` | 是否有核心（影响核心命中逻辑） |
| `distanceZone` | 当前距离区间（`NEAR/MID/FAR/null`） |

### 11.2 阶段调度（enemyPhases）

- 配置为 `{ startTick, zone }` 数组，按 startTick 升序。
- 支持区间：`NEAR` / `MID` / `FAR` / `HIDDEN`（不可瞄准）。
- `HIDDEN` 阶段：所有单位停止射击，触发装填（ammoLeft → 0）。
- 离开 HIDDEN：恢复被中断的自愿装填（原弹药恢复）。

### 11.3 属性克制关系

```
Fire（燃烧）→ Wind（风压）→ Iron（铁甲）→ Electric（电击）→ Water（水冷）→ Fire（循环克制）
```

克制方在 ElementMultiplier 获得基础 +10% 加成（可被技能进一步提升）。被克制方无减伤惩罚。

---

## 附录：已知未建模或存疑项

| 机制 | 当前状态 |
|------|----------|
| 护盾吸收伤害 | 护盾仅存储，未参与 HP 扣减计算 |
| SG 核心命中率 | 固定 20%，应为 `20% + 0.8 × HitRate` |
| AR 核心命中率 | 默认 1.0（所有攻击必中核心），实际应有命中率判定 |
| 掩体 HP | 仅建模事件，不追踪掩体数值 |
| 命中率（Hit Rate）| `hitRatePct` 仅记录，默认必定命中 |
