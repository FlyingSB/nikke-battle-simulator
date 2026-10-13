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
   **HP 相关效果**：治疗用 `applyHeal(state, target, amount, logCtx, caster)` / `pushHoT(..., caster)`，
   `amount` 为描述基础量，治疗者 `caster` 必须传入（治疗效能据此计算）；「Current HP ▼」用 `applyHpLoss`；
   「Current HP ▼ X%」= 当前 HP × X%。「HP 低于 / 高于 X%」类条件一律用 `HP_CHANGED` 触发器 + `getHpRatio` 判定
   （「跌破 / 降至 X% 以下」按比例：`ctx.newRatio < ctx.prevRatio`，Max HP ▲ 使比例下降也算；
   只关心当前 HP 实际变化的用 `ctx.newHp !== ctx.prevHp`）；「相邻 / 两侧友军」用 `getAdjacentAllies`
   （按站位，空位占位置），位置判定用 `getUnitPosition`，不要用 `state.squad` 下标；`Max HP ▲` 只提升上限、不回复当前 HP（游戏基础机制，无需额外字段），
   技能主动删除 / 减层带 Max HP 的 buff 后调用 `clampHpToMax`；
   溢出治疗储存用 `applyOverhealStorage`；「平均分摊治疗」在 buff 上加 `shareHeal: true`。
   **B3 爆裂直接伤害**：按 2.1 节由描述措辞判定是否受全爆裂系列加成，延迟按「进入全爆裂后」填写。
   **双枪角色**（`shot_detail.muzzle_count === 2`）：普攻与切换武器的武器伤害系数由引擎自动 ×2
   （[battle-logic.md §4.6.1](battle-logic.md)），技能文件无需处理；若技能已用双重命中等方式体现双枪，
   切换时设 `skillState.weaponSwitchDualGun = false` 避免重复翻倍。
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

### 2.1 B3 爆裂直接伤害：全爆裂加成判定与延迟

**加成判定**（无实测时先按描述措辞判定，见 [dev/game-data.md](../dev/game-data.md)「关于Burst 3伤害类型的猜测」）：

| 描述措辞 | 全爆裂 +50% 与 ENTER_FULL_BURST buff | 建模 |
|---|---|---|
| `... as damage.` | 不受影响（默认） | 直接 `fireSkillHit`（引擎自动延迟、预捕获施放时 sums、屏蔽全爆裂补正） |
| `... as Burst Skill damage.` | 不受影响（默认） | 同上 |
| `... as additional damage.` | **受影响** | 命中加 `opts: { affectedByFullBurst: true }`、不传 `sums`；或 `pendingFireInBurstHits` 且 `sums: null`。引擎统一在进入全爆裂瞬间（ENTER_FULL_BURST 后）快照 sums，再按延迟出伤 |

判定结果须在技能块注释中写明依据，格式：`【全爆裂加成】受影响（描述 as additional damage）`；
有实测时追加「已实测」，实测数据记入 dev/game-data.md。**实测结果优先于措辞规则。**

| 角色 | 描述 | 判定 | 依据 |
|---|---|---|---|
| Rapi: Red Hood (16) | as additional damage | 受影响 | 已实测，与规则一致 |
| Liberalio (262) | as additional damage | 受影响 | 已实测，与规则一致 |
| Cinderella (511) Burst Part2 | as additional damage | 受影响 | 已实测，与规则一致（Part1 as damage 默认） |
| Elegg: Boom and Shock (502) | as damage | **受影响** | 已实测，**规则例外**；S2 Part1 ATK ▲ 与 S1 属性优势 buff 均先计入快照（后者在 `FULL_BURST_SNAPSHOT` 时移除） |
| Ein (391) Burst P2 | as true damage | **受影响** | 已实测，**规则例外** |
| Laplace: Ultimate Hero (103) Burst P3 | as additional damage | 受影响 | 规则判定，未实测 |
| Sin: Swift Bunny (405) Burst P3 | as additional damage | 受影响 | 规则判定，未实测 |

**延迟计时**：B3 施放后固定 0.05s 才进入全爆裂（`FULL_BURST_ENTRY_DELAY_TICKS`，2026-10-12 实测）。
B3 施放者爆裂技能（`burst` 槽 `BURST_SKILL_USE`）的伤害一律**从进入全爆裂开始计时**：

- 技能文件中写的延迟（`fireTick: state.tick + Math.round(X * TICK_RATE)`）表示「进入全爆裂后 X 秒」，
  引擎自动再后移 0.05s；即时 `fireSkillHit` 视为「进入全爆裂后 0 秒」，引擎自动转为延迟命中。
- 受全爆裂影响的命中若在进入全爆裂前到期，引擎兜底推迟到进入全爆裂（ENTER_FULL_BURST 之后）结算。
- 同一角色作为 B1/B2 施放（如 Combat Assist）不适用本节。

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
合并 buff 含**两种及以上类型**时不能用 `(类型)` 后缀命名（只写其中一种会与单一类型 buff 混淆），
跳过表中优先级 3、4，按优先级 1、2 判断后命名为 **`技能名 Pn`**（不带类型后缀）；同一段内仍有多条需区分时自定义并汇报。
例：Prika S1 P1（Explosion Damage + Pierce Damage + ATK flat）→ `Let's Get the Show Started P1`。

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
| `normalAttackDamagePct` / `normalAttackDamageMultPct` | Normal Attack Damage（描述为 "Normal Attack Damage **Multiplier**" 时必须用 `normalAttackDamageMultPct`：与珍藏品普攻倍率同乘区） |
| `critRatePct` / `normalAttackCritRatePct` | Crit Rate |
| `chargeSpeedPct` / `chargeTimeReductionTicks` | Charge Speed |
| `reloadSpeedPct` | Reload Speed |
| `maxAmmoPct` / `maxAmmoFlat` | Max Ammo |
| `maxHpPct` / `maxHpFlat` | Max HP（只改上限、不回复当前 HP；就地改写数值须用 `setMaxHpBuffValue`） |
| `atkSpeedPct` | Attack Speed |
| `hitRatePct` | Hit Rate |
| `defPct` / `defFlat` | DEF |
| `burstGaugeFlat` | Burst Gauge（「Burst Gauge filling speed ▲ n%」= 施法者 `targetBurstEnergyPerShot` × n% 的固定值，对所有目标相同，用一条 `unitId: null` buff） |
| `lifeStealPct` | Life Steal（「Restores HP equal to X% of attack damage」，旧版原文「Recovers X% of attack damage as HP」；视为 HP 回复，派发 HEAL_RECEIVED） |
| `healPotencyPct` | Outgoing Healing（「Outgoing Healing ▲」，施放的治疗量；挂在治疗者身上，治疗调用须传 caster 才生效） |
| `incomingHealPct` | Incoming Healing（「Incoming Healing ▲」，受到的治疗量；挂在受治疗者身上，作用于一切受到的治疗。旧版原文「Potency of HP restored ▲」多数已统一为此词，个别描述写作「Healing ▲」，以实际效果为准） |
| `pierce` | Pierce |
| `pelletFlat` / `pelletFixed` | Pellets |
| `mgHeatSpeedPct` | MG Heating up |
| `enemyDamageTakenPct` | Damage Taken |
| `enemyDefDownPct` | DEF Down |
| `allEnemiesBurstDamagePct` | All-Enemies Burst Damage（「目标说明以『全体敌人』结尾的爆裂技能伤害 ▲」，Trina Spread Roots；引擎按命中标签与爆裂描述 ■ 段自动判定，见 `battle-utils.isAllEnemiesBurstHit`） |
| `skill2CooldownReductionPct` | Skill 2 CD（「Cooldown of Skill 2 ▼ X%」，仅对经 `skills/active-skill-shared.js` 推进冷却的主动 S2 生效） |
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
