# 战斗代码审阅报告

> 基于 `battle-logic.md` 逐条对照 `battle.js` / `damage.js` / `battle-utils.js`。  
> 仅列出与文档存在差异的条目；已正确实现的条目略去。

---

## 一、确认 Bug（行为与文档不符）

### Bug 1：`normalAttackCritRateBonus` 在蓄力普攻中被错误排除；技能伤害中被错误包含

**文档（§3.7）**：
> `normalAttackCritRateBonus`：游戏内"普通攻击暴击率"加成，**不区分蓄力与否**，仅适用于普通攻击（不含技能伤害或爆裂技能）。

**代码现状 A — `battle.js` 普通攻击循环（约第 854 行）：**
```js
const effectiveCritRate = Math.min(1, (unit.stats.critRate ?? 0.15) + sums.critRateBonus
  + (isCharged ? 0 : (sums.normalAttackCritRateBonus ?? 0)));
//   ^^^ SR/RL 蓄力普攻时被清零，与文档矛盾
```

**代码现状 B — `battle-utils.js fireSkillHit`（约第 216 行）：**
```js
const effectiveCritRate = (unit.stats.critRate ?? 0.15) + sums.critRateBonus
  + (charged ? 0 : (sums.normalAttackCritRateBonus ?? 0));
//   ^^^ AR/SMG/MG/SG 的技能伤害（S1/S2/Burst）会错误叠加此加成
```

**正确逻辑：**

| 场景 | 是否包含 `normalAttackCritRateBonus` |
|------|--------------------------------------|
| 普通攻击（无论蓄力） | ✓ 应包含 |
| 技能伤害（S1/S2/Burst） | ✗ 不应包含 |

**修复方案：**
```js
// battle.js 普通攻击（去掉蓄力判断，无论 isCharged 均加入）：
const effectiveCritRate = Math.min(1, (unit.stats.critRate ?? 0.15)
  + sums.critRateBonus + (sums.normalAttackCritRateBonus ?? 0));

// battle-utils.js fireSkillHit（技能命中完全不包含此项）：
const effectiveCritRate = Math.min(1, (unit.stats.critRate ?? 0.15) + sums.critRateBonus);
```

---

### Bug 2：`tempMaxAmmoMult` 生效时 `effectiveMax` 的 OL 弹药发数计算错误

**文档（§5.2）**：
> 若有 `tempMaxAmmoMult`（如 SBS S2）：`Math.max(1, baseAmmo + Math.round(baseAmmo × (mult - 1))) + bonusAmmo + favAmmoBonus`  
> `bonusAmmo` = `Math.round(baseAmmo × stats.bonusAmmo)`（OL 词条换算后的整数发数）。

**代码现状（`battle.js` 约第 781 行）：**
```js
const effectiveMax =
  (ammoMult !== 1
    ? Math.max(1, unit.baseAmmo + Math.round(unit.baseAmmo * (ammoMult - 1)))
      + (unit.stats.bonusAmmo ?? 0) + unit.favAmmoBonus
    //  ^^^^^^^^^^^^^^^^^^^^^^
    // stats.bonusAmmo 是百分比小数（如 0.1），直接相加等同于加了 0.1 发
    : unit.maxAmmo);
```

`unit.stats.bonusAmmo` 是百分比（如 0.1 = 10%），而 `unit.favAmmoBonus` 已经是整数发数。两者语义不一致，导致 OL 弹药词条在此分支中几乎被忽略。

**修复方案：**
```js
? Math.max(1, unit.baseAmmo + Math.round(unit.baseAmmo * (ammoMult - 1)))
  + Math.round(unit.baseAmmo * (unit.stats.bonusAmmo ?? 0)) + unit.favAmmoBonus
```

> **影响范围**：仅当角色同时拥有 OL 弹药词条（`stats.bonusAmmo > 0`）且激活 `tempMaxAmmoMult` 效果时触发。

---

### Bug 3：`ENTER_FULL_BURST` 触发期间新增的延迟命中未打 `suppressFullBurst`

**文档（§3.9 / §8.5）**：
> 引擎自动对所有新入队的延迟命中打 `suppressFullBurst=true` 标记（`affectedByFullBurst` 的除外）。

**代码现状（`battle.js applyFullBurstSkills`）：**

```js
// 仅对 B3 BURST_SKILL_USE 期间新增的命中打标记
for (let i = prePendingLen; i < state.pendingSkillHits.length; i++) {
  if (!h.opts.affectedByFullBurst) h.opts.suppressFullBurst = true;
}

// 之后执行 ENTER_FULL_BURST 触发，新增的延迟命中不在标记范围内：
executeSkillTriggers(state, 'ENTER_FULL_BURST');
flushHealReceived(state);
// ← 此处新增的 pendingSkillHits 没有 suppressFullBurst
```

当 `ENTER_FULL_BURST` 触发的技能推入延迟命中时，后续 tick 处理这些命中：
- `fullBurstActive = true`，`burstSkillFiring = false`，`suppressFullBurst` 缺失
- → `isFullBurst = true`，错误获得 +50% 补正

**修复方案（在 `applyFullBurstSkills` 中，`executeSkillTriggers('ENTER_FULL_BURST')` 之后）：**
```js
const prePendingLenFull = state.pendingSkillHits.length;
executeSkillTriggers(state, 'ENTER_FULL_BURST');
flushHealReceived(state);
for (let i = prePendingLenFull; i < state.pendingSkillHits.length; i++) {
  const h = state.pendingSkillHits[i];
  if (!h.opts) h.opts = {};
  if (!h.opts.affectedByFullBurst) h.opts.suppressFullBurst = true;
}
```

---

## 二、缺失功能（文档已定义但未实现）

### 缺失 1：Buff `stackLimit > 1` 叠加机制未实现

**文档（§7.2）**：
> 可叠加效果（`stackLimit > 1`）：同名 buff 叠加时均刷新 `endTick`；若当前层数 < `stackLimit`，同时新增一层；`getBuffSums` 时所有层数值叠加；到期时一次性移除全部层数。

**代码现状（`battle-utils.js pushBuff`）：**
```js
const existing = state.buffs.find(b => b.name === buffObj.name && b.unitId === buffObj.unitId);
if (existing) {
  existing.endTick = Math.max(existing.endTick, buffObj.endTick);
  return;  // 永远不创建新层，stackLimit 字段被完全忽略
}
```

目前所有 buff 均以 `stackLimit=1` 处理。若任何技能文件使用了 `stackLimit > 1` 的 buff，层数叠加不会生效。

**修复方向**：在 `pushBuff` 中读取 `buffObj.stackLimit`；当 `existing` 存在且层数（可通过 `existing.stacks` 字段追踪）< 上限时，向 `state.buffs` 追加新条目，并更新 `existing.endTick`（整体刷新）。

---

### 缺失 2：核心"被保护"状态未建模

**文档（§3.8）**：
> **核心被保护**：核心被护甲遮蔽，普通攻击无法命中核心；仅穿透攻击（`isPierce=true`）可命中核心。

**代码现状**：`state` / `config.enemy` 中不存在 `enemyCoreProtected` 字段，`isCore` 判定只依赖 `enemyHasCore` 和 `coreHitRateMult`，无穿透条件分支。

> 注：影响程度取决于是否有具体 Boss 阶段配置了此状态，目前已知 Boss 未使用，可暂后。

---

## 三、命名不一致（不影响功能，但会造成混淆）

### `sustainedDamagePct` vs `sustainedDamageMult`

**文档（§7.1）**：
> `sustainedDamagePct`：持续伤害%（原名 `sustainedDamageMult`，已重命名）

**代码现状**：`battle-utils.js getBuffSums`、`fireSkillHit`、以及各技能文件的 buff 对象中仍使用旧名 `sustainedDamageMult`。

**建议**：选择一个方向统一：
- 若将代码全面改为 `sustainedDamagePct`：需更新 `getBuffSums` 的变量名、技能文件中所有 buff 的 key、`fireSkillHit` 的 extra 字段名。
- 若保留代码旧名：将文档改回 `sustainedDamageMult`（当前实现是正确的，文档超前于代码）。

---

## 四、设计实现差异（功能结果正确，但与文档描述机制不同）

### `fullBurstActive` 的设置时序

**文档（§3.9 / §6.5）**：
> 直接伤害类 B3 爆裂技能结算时 `fullBurstActive` 尚未为 `true`，自然不受 +50% 补正影响。

**代码现状**：`battle.js` 在调用 `applyFullBurstSkills`（B3 技能在此执行）**之前**已将 `fullBurstActive = true`。通过 `state.burstSkillFiring` 标志在 `fireSkillHit` 中补偿：

```js
// battle.js（B2 延迟结束）
state.fullBurstActive = true;           // ← 先设
const fired = applyFullBurstSkills(state);  // ← 再执行 B3

// fireSkillHit 中的补偿逻辑（battle-utils.js）：
const isFullBurst = state.fullBurstActive &&
  (opts.affectedByFullBurst || (!state.burstSkillFiring && !opts.suppressFullBurst));
//                               ^^^ B3 期间 burstSkillFiring=true，抵消了 fullBurstActive
```

**最终效果**：B3 直接命中不受全爆裂补正，与文档一致。但若未来误删 `burstSkillFiring` 检查，会引入隐性 Bug。建议将 `fullBurstActive = true` 的设置移至 `applyFullBurstSkills` 内部、所有 B3 技能执行完毕且 `ENTER_FULL_BURST` 触发前，与文档对齐。

---

## 五、已知未建模条目（文档附录已记录，不纳入此次审阅）

| 条目 | 当前状态 |
|------|----------|
| 护盾吸收伤害 | 护盾仅存储，未参与 HP 扣减 |
| AR 核心命中率实际判定 | 默认 1.0（所有攻击必中核心） |
| SG 核心命中率完整公式 | 固定 20%，应为 `20% + 0.8 × HitRate` |
| 掩体 HP 追踪 | 仅建模事件 |
| 命中率（HitRate）| 默认必定命中 |

---

## 优先级汇总

| 优先级 | 编号 | 标题 |
|--------|------|------|
| **高** | Bug 1-A | SR/RL 蓄力普攻错误排除 `normalAttackCritRateBonus` |
| **高** | Bug 1-B | AR 等武器技能伤害错误包含 `normalAttackCritRateBonus` |
| **中** | Bug 3 | `ENTER_FULL_BURST` 触发的延迟命中未打 `suppressFullBurst` |
| **中** | 缺失 1 | Buff `stackLimit` 叠加机制 |
| **低** | Bug 2 | `tempMaxAmmoMult` 时 OL 弹药发数计算错误 |
| **低** | 设计差异 | `fullBurstActive` 时序（功能正确，存在潜在风险） |
| **整理** | 命名 | `sustainedDamagePct` vs `sustainedDamageMult` |
| **待定** | 缺失 2 | 核心被保护状态 |
