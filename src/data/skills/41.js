import { pushBuff, fireSkillHit, getBuffSums, recalcMaxAmmo, TICK_RATE } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// Character: K  (resource_id: 41)
//
// 武器：SMG（1440 RPM，弹匣 120）。爆裂阶段 Step3，CD 40s。
//
// 爆裂切换武器：CDN ulti skill_value_data = [伤害 5466, 144, 切换武器 shot_id 1004102, 1]，
// 第 2 项 144 = 1440 RPM × (1 − 90%)（描述 Attack speed ▼ 90%）→ 切换武器射速（RPM）。
// 「Damage: X% of final ATK / Pelletcount: 10」：伤害按整发合计（与 SG shot_detail.damage 口径一致，
// nikke.gg 亦按合计解读）；描述未给出弹匣 → 切换期间不耗弹。切换武器按 SG 处理。
// 实测（2026-10-11）：切换武器 10s 内攻击 24 次，与 144 RPM 一致。
// 切换武器散布圈无本地数据，按目测约 250（与 Isabel 等常规 SG 相同，固定不收束）走核心命中几何模型
// （weaponSwitchAccuracyScale，受命中率影响），未做精确测量。

const TILTED_SCALE = 'Tilted Scale';
const FULFILLMENT  = 'Fulfillment of Righteousness';
const CRIT_KEY     = 'kPelletCrits';
const SWITCH_ACCURACY_SCALE = 250;   // 切换武器散布圈（目测）

function switchRateOfFire(caster) {
  return caster.rawBurst?.skill_value_data?.[1]?.skill_value ?? 144;
}

// S2 P1：获得 Tilted Scale 时 → 全体 Fulfillment of Righteousness
//   最大装弹数 ▼ p00%（同类效果不叠加）+ 攻击伤害 ▲ p02%，同为 10s，合并为一条
function applyFulfillment(state, caster) {
  const lv  = caster.skillLevels[1];
  const raw = caster.rawSkill2;
  pushBuff(state, { name: FULFILLMENT, unitId: null,
    maxAmmoPct:      -getSkillValue(raw, 0, lv) / 100,
    attackDamagePct:  getSkillValue(raw, 2, lv) / 100,
    endTick: state.tick + TICK_RATE * getSkillValue(raw, 1, lv) },
    { unitName: caster.name, skillLabel: raw?.name_localkey ?? 'S2', slot: 'S2',
      partIdx: 0, lineIdx: null, trigger: state._logCtx?.trigger ?? '' });
}

export default {

  // ── Scale of Righteousness（S1）
  // ■ Activates when firing the last bullet. Affects self.
  //   Tilted Scale: Critical rate ▲ {p00}% continuously, stacks up to {p01} time(s).
  //   Stack count of Tilted Scale ▲ {p02}.
  // ■ Activates when pellets land critical hit {p03} time(s). Affects the target.
  //   Deals {p04}% of final ATK as additional damage.
  // ■ Activates when Full Burst ends. Affects self.
  //   Removes Tilted Scale.
  // p00: [0.44,0.47,0.51,0.54,0.58,0.61,0.64,0.68,0.71,0.75]
  // p01: [100,...]
  // p02: [9,9,9,19,19,19,29,29,29,29]
  // p03: [4,...]
  // p04: [14.12,15.21,16.3,17.38,18.47,19.56,20.64,21.73,22.82,23.9]
  skill1: {
    triggers: [
      // P1：打出末弹 → Tilted Scale 层数 ▲ p02（上限 p01，持续至全爆裂结束），随后触发 S2 P1
      {
        on: 'LAST_BULLET',
        handler(state, caster) {
          const lv    = caster.skillLevels[0];
          const raw   = caster.rawSkill1;
          const limit = getSkillValue(raw, 1, lv);
          const before = state.buffs.find(b => b.name === TILTED_SCALE && b.unitId === caster.id)?.stacks ?? 0;
          pushBuff(state, { name: TILTED_SCALE, unitId: caster.id,
            critRatePct: getSkillValue(raw, 0, lv) / 100, stackLimit: limit, endTick: Infinity });
          const buff = state.buffs.find(b => b.name === TILTED_SCALE && b.unitId === caster.id);
          buff.stacks = Math.min(limit, before + getSkillValue(raw, 2, lv));
          applyFulfillment(state, caster);
        },
      },
      // P2：弹丸暴击累计 p03 次 → 对目标 p04% 最终 ATK 追加伤害。
      //     引擎按整发判定暴击（弹丸同时暴击），暴击发按弹丸数计入。
      {
        on: 'SHOT_COUNT',
        handler(state, caster, ctx) {
          if (!ctx.isCrit) return false;
          const lv    = caster.skillLevels[0];
          const raw   = caster.rawSkill1;
          const every = getSkillValue(raw, 3, lv);
          const st    = caster.skillState;
          st[CRIT_KEY] = (st[CRIT_KEY] ?? 0) + (ctx.pellets ?? 1);
          while (st[CRIT_KEY] >= every && state.enemyHp > 0) {
            st[CRIT_KEY] -= every;
            fireSkillHit(state, caster, getSkillValue(raw, 4, lv) / 100, getBuffSums(state, caster.id), 'S1 P2');
          }
        },
      },
      // P3：全爆裂结束 → 移除 Tilted Scale
      {
        on: 'FULL_BURST_END',
        handler(state, caster) {
          state.buffs = state.buffs.filter(b => !(b.name === TILTED_SCALE && b.unitId === caster.id));
        },
      },
    ],
  },

  // ── Execution of Righteousness（S2）
  // ■ Activates when gaining Tilted Scale. Affects all allies.
  //   Fulfillment of Righteousness
  //   Function: Reduces max ammunition capacity but increases attack damage.
  //   Effect 1: Max ammunition capacity ▼ {p00}% for {p01} sec. (Similar effects cannot be stacked.)
  //   Effect 2: Attack damage ▲ {p02}% for {p03} sec.
  // ■ Activates when Full Burst ends. Affects all allies.
  //   Removes Fulfillment of Righteousness.
  // p00: [30.21,32.54,34.86,37.19,39.51,41.84,44.16,46.49,48.81,51.13]
  // p01: [10,...]
  // p02: [6.27,6.76,7.24,7.72,8.21,8.69,9.17,9.66,10.14,10.62]
  // p03: [10,...]
  skill2: {
    triggers: [
      // P1：随 S1 P1 获得 Tilted Scale 触发（见 applyFulfillment）
      {},
      // P2：全爆裂结束 → 移除 Fulfillment of Righteousness（最大装弹数恢复）
      {
        on: 'FULL_BURST_END',
        handler(state) {
          if (!state.buffs.some(b => b.name === FULFILLMENT)) return false;
          state.buffs = state.buffs.filter(b => b.name !== FULFILLMENT);
          for (const u of state.squad) recalcMaxAmmo(state, u);
        },
      },
    ],
  },

  // ── Means of Righteousness（Burst）
  // ■ Affects self.
  //   Change the weapon in use:
  //   Damage: {p00}% of the final ATK
  //   Pelletcount: 10
  //   Attack speed: ▼ 90%
  //   Duration: {p01} sec
  //   Additional Effects:
  //   ATK ▲ {p02}% of caster's ATK for {p03} sec.
  //   Attack damage ▲ {p04}% for {p05} sec.
  // p00: [54.66,58.86,63.07,67.27,71.48,75.68,79.89,84.09,88.3,92.5]
  // p01: [10,...]
  // p02: [37.44,40.32,43.2,46.08,48.96,51.84,54.72,57.6,60.48,63.36]
  // p03: [10,...]
  // p04: [12.48,13.44,14.4,15.36,16.32,17.28,18.24,19.2,20.16,21.12]
  // p05: [10,...]
  burst: {
    triggers: [
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const lv  = caster.skillLevels[2];
          const raw = caster.rawBurst;
          const end = state.tick + TICK_RATE * getSkillValue(raw, 1, lv);
          Object.assign(caster.skillState, {
            weaponSwitchHitMult:       getSkillValue(raw, 0, lv) / 100,
            weaponSwitchType:          'SG',
            weaponSwitchEndTick:       end,
            weaponSwitchRoundsLeft:    0,
            weaponSwitchUnlimitedAmmo: true,
            weaponSwitchRateOfFire:    switchRateOfFire(caster),
            weaponSwitchAccuracyScale: SWITCH_ACCURACY_SCALE,
            weaponSwitchPierce:        false,
          });
          caster.reloadTick = 0;
          if (caster.ammoLeft <= 0) caster.ammoLeft = caster.maxAmmo;
          // 弹丸数 10（切换武器为 SG 型，弹丸数影响 S1 P2 暴击计数）+ ATK ▲（施法者 ATK 固定值）+ 攻击伤害 ▲，
          // 同为自身 10s，合并为一条
          pushBuff(state, { name: 'Means of Righteousness', unitId: caster.id,
            pelletFixed: 10,
            atkFlat: Math.round(caster.stats.atk * getSkillValue(raw, 2, lv) / 100),
            attackDamagePct: getSkillValue(raw, 4, lv) / 100,
            endTick: state.tick + TICK_RATE * getSkillValue(raw, 3, lv) },
            { ...state._logCtx, partIdx: null });
        },
      },
    ],
  },
};
