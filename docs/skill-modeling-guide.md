# 技能建模流程与命名规范

> 新建或修改 `src/data/skills/<resource_id>.js` 时必须遵循本文档。
> 引擎机制见 [battle-logic.md](battle-logic.md)，角色清单见 [data-catalog.md](data-catalog.md)。

---

## 1. 建模流程检查清单

1. **确认角色与技能原文**：从 `src/data/static/nikke/<id>.json` 读取 `name_localkey` / `description_localkey`，
   角色名以 [data-catalog.md](data-catalog.md) 或文件头注释为准，不得凭记忆推断。
2. **文件头注释**：import 之后、`export default` 之前写
   `// Character: <完整游戏内角色名>  (resource_id: <id>)`；有 SSR 珍藏品再加一行 `// SSR 珍藏品: <名>（id: <id>）`。
3. **每个技能块前粘贴描述原文与参数数列**（`// ── 技能名` + 逐行描述 + `// pNN: [...]`），参数一律用 `getSkillValue` 读取。
4. **按本文第 2–4 节为伤害标签、效果段标签、buff 命名**；自定义命名须在回复中列表汇报。
5. **多目标效果用 `unitIds`**（第 5 节），不要在 `pushBuff` 外循环；动态倍率效果传 `multiplier`。
6. **段号对齐**：触发器数组序号与 ■ 段不一致时用 `partOverride`，不要"接受偏移"。
7. **注册**：在 `src/data/skill-traits.js` 注册；在 [data-catalog.md](data-catalog.md) 角色表添加条目。
8. **测试**：`node scripts/tests/test-all.mjs` 全部通过。

---

## 2. 伤害技能命中标签（`fireSkillHit` / `pendingSkillHits` / `state.dots` 的 `label`）

标签格式为 `'<槽位>[ P<n>][ <名称>]'`，槽位 ∈ `S1` / `S2` / `Burst`。
引擎把 `'S1'`、`'S1 P3'` 解析为「技能名」/「技能名 P3」；带名称的标签只显示名称部分，槽位与段号用于定位 tooltip。

| 优先级 | 条件 | 标签写法 | 示例 |
|---|---|---|---|
| 1 | 描述明确给出该次攻击的名称 | `'<槽位> P<n> <名称>'` | Anis: Star `'Burst P1 Shooting Stars'`；Rosanna `'Burst P1 Assalto'` |
| 2 | 整个技能只有一处伤害 | `'<槽位>'` | Anis: Star S1 P3 → `'S1'`（显示 "Starfall"） |
| 3 | 该 ■ 段只有一处伤害 | `'<槽位> P<n>'` | Nayuta `'S1 P4'` / `'S1 P5'` |
| 4 | 其余情况 | 自定义名称，并在回复中列表汇报 | Scarlet: Black Shadow `'S1 Breakthrough I/II/III'` |

> 攻击次数（Three times / Six times）、阶段序号等不是名称；需要区分时自定义并汇报。

---

## 3. 效果段标签（战斗日志「技能」列，由 `logCtx.partIdx` 决定）

| 优先级 | 条件 | 做法 |
|---|---|---|
| 1 | 描述给出的是**技能名**（而非效果名） | 用该名覆盖 `skillLabel`；此类情况极少，发现后汇总成表汇报 |
| 2 | 技能中只有一个未具名的效果段（伤害段、已具名效果段不计） | `pushBuff(..., { ...state._logCtx, partIdx: null })`，标签只显示技能名 |
| 3 | 其余 | 默认 `partIdx`（显示「技能名 Pn」）；序号错位时用触发器 `partOverride` |
| 4 | 仍有歧义 | 自定义并汇报 |

`lineIdx` 仅用于 tooltip 行高亮（UI 在段内行数 > 2 时会在标签后追加 Ln），不作为命名依据。

---

## 4. Buff 命名（`pushBuff` 的 `name`）

| 优先级 | 条件 | 命名 | 示例 |
|---|---|---|---|
| 1 | 描述明确给出效果名 | 原名 | `Raging Current`、`Drunken`、`My Own Star`、`Making Memories` |
| 2 | 技能中只有一个未具名 buff | 技能名 | `Sparkling Boost`、`A Pirate's Heart`、`Double Boost` |
| 3 | 该效果类型在技能中唯一 | `技能名 (类型)` | `Calm Depths (ATK)`、`Stardust (Attack Damage)` |
| 4 | 类型在技能中重复，但在段内唯一 | `技能名 Pn (类型)` | `Game Master P2 (Max HP)`、`Shades of White P3 (ATK)` |
| 5 | 其余 | 自定义并汇报 | `Drop the Beat (Crit Damage 1/2/3)`、`Pierce Equation P1 (Pierce Damage 1R)` |

### 4.1 效果合并

子项**互不处于同一伤害乘区或不直接影响伤害**，且**作用对象与持续时间相同**时合并为一条 buff
（如 Crit Rate + ATK flat、Elem Adv Damage + Pierce Damage + ATK flat）。
合并 buff 的「类型」取其**主类型**：按下表自上而下第一个直接影响伤害的字段。

### 4.2 类型词表（buff 字段 → 类型名）

| 字段 | 类型名 |
|---|---|
| `atkPct` / `atkFlat` | ATK |
| `attackDamagePct` | Attack Damage |
| `critDamagePct` | Crit Damage |
| `chargeDamagePct` / `chargeDamageMultPct` | Charge Damage |
| `coreDamagePct` | Core Damage |
| `elementAdvantagePct` | Elem Adv Damage |
| `elementAdvantageVs` | Elem Adv |
| `pierceDamagePct` | Pierce Damage |
| `distributedDamagePct` | Distributed Damage |
| `sustainedDamagePct` | Sustained Damage |
| `trueDamagePct` | True Damage |
| `damageToPartsPct` / `interruptionPartsDamagePct` | Parts Damage |
| `projectileExplosionDamagePct` | Explosion Damage |
| `projectileAttachmentDamagePct` | Attachment Damage |
| `sequentialAttackDamagePct` | Sequential Damage |
| `normalAttackDamagePct` | Normal Attack Damage |
| `critRatePct` / `normalAttackCritRatePct` | Crit Rate |
| `chargeSpeedPct` / `chargeTimeReductionTicks` | Charge Speed |
| `reloadSpeedPct` | Reload Speed |
| `maxAmmoPct` / `maxAmmoFlat` | Max Ammo |
| `maxHpPct` / `maxHpFlat` | Max HP |
| `atkSpeedPct` | Attack Speed |
| `hitRatePct` | Hit Rate |
| `defPct` / `defFlat` | DEF |
| `burstGaugeFlat` | Burst Gauge（「Burst Gauge filling speed ▲ n%」= 施法者 `targetBurstEnergyPerShot` × n% 的固定值，对所有目标相同，用一条 `unitId: null` buff） |
| `lifeStealPct` | Life Steal |
| `pierce` | Pierce |
| `pelletFlat` / `pelletFixed` | Pellets |
| `mgHeatSpeedPct` | MG Heat |
| `enemyDamageTakenPct` | Damage Taken |
| `enemyDefDownPct` | DEF Down |
| 爆裂冷却缩减（`buffLog` cd_reduction 条目） | Burst CD |

---

## 5. 日志显示约定

### 5.1 多目标合并为一行：`unitIds`

对若干指定目标施加同一效果时，传 `unitIds` 数组，引擎为每个目标推入独立 buff（层数、回合各自维护），
战斗日志只记一行（目标列列出各单位名，覆盖全队时显示「全体队友」）。

```js
// 正确
const unitIds = state.squad.filter(u => u.weaponType === 'SG').map(u => u.id);
pushBuff(state, { name: 'Calm Sniping (Pierce Damage)', unitIds, pierceDamagePct: pct, endTick });

// 错误：在 pushBuff 外循环，会产生 N 行日志
for (const u of state.squad) pushBuff(state, { name: ..., unitId: u.id, ... });
```

全队共享且数值一致时仍可用 `unitId: null`（可配 `weaponFilter`）。
各目标数值不同（如按各自充能换算的 `burstGaugeFlat`）时才允许循环，并注明原因。

### 5.2 动态倍率：`multiplier`

效果数值已按动态倍率 n（层数、计数等）放大时传 `multiplier: n`，伤害公式明细中 buff 名后显示 `*n`：

```js
pushBuff(state, { name: 'A Pirate\'s Romance (ATK)', unitId: null,
  atkFlat: Math.round(caster.stats.atk * perStack * stacks), multiplier: stacks, endTick });
```

可叠层 buff（`stackLimit > 1`）层数大于 1 时同样显示 `*层数`，无需额外传参。
