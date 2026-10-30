import { pushBuff, fireSkillHit, getBuffSums, isPartsHit, TICK_RATE } from '../../engine/battle-utils.js';
import { getSkillValue } from '../../data/models.js';

// Character: Laplace  (resource_id: 100)
// SSR 珍藏品: Hero Trilogy BD（id: 200401）
// 所有三个技能槽均被 SSR 珍藏品替换（skill_change_slot=1/2/3），仅建模 SSR 版（见 docs/ssr-collectible-rules.md）。
//
// 武器：Rocket Launcher（UP 型，蓄力 1s，弹匣 6，FC 250%，弹速 300）。爆裂阶段 Step3，CD 40s。
//
// 爆裂切换武器（激光，CDN skill_type = LaserBeam）：
//   基础版 ulti skill_value_data = [53040, 858, 切换武器 shot_id 1010002, 1440, 0]，第 4 项按 Takina / K 惯例为射速 1440 RPM
//   （SSR 珍藏品技能数据不含 skill_value_data，且 SSR 时 caster.rawBurst 为珍藏品版本，故此处写死）。
//   实测（2026-10-19，用户）：无增益、Hero Vision 0 层，一轮爆裂 Normal Damage 合计 54,277,950（不含 First Damage），
//     全部命中核心，非暴击 217,809 / 暴击 261,370 → 唯一整数解 236 击（暴击 66 次）。
//   1440 RPM = 2.5 tick/击，10s 理论 240 击；激光在 First Damage 后 LASER_START_DELAY_TICKS 开始，取 10 → 236 击，与实测一致。
//   （社区旧数据 5s ≈94 击 / 10s ≈193 击 偏低，射速随 FPS 变化，应为低帧率设备测得。）
//   命中特性（arca.live 实测）：First Damage 可暴击、可穿透、不可命中核心；Normal Damage 可暴击、可核心、可穿透（按普攻判定）；
//   S1 满层追加的真实伤害可暴击，不可核心、不可穿透。激光精准（pin point accuracy），Normal Damage 核心率按 100%。
//   「Unable to take cover」：激光期间无法停止攻击，敌人隐藏 / 跳起时仍向空中开火（不造成伤害），击发节奏不中断。
const LASER_RPM               = 1440;
const LASER_START_DELAY_TICKS = 10;
// B3 施放后 0.05s 进入全爆裂（FULL_BURST_ENTRY_DELAY_TICKS），爆裂伤害从进入全爆裂开始计时（skill-modeling-guide §2.1）
const FULL_BURST_ENTRY_DELAY_TICKS = Math.round(TICK_RATE * 0.05);

const HERO_VISION        = 'Hero Vision';
const FIRST_DAMAGE_LABEL = 'Burst P1 First Damage';
const LASER_LABEL        = 'Burst P1 Normal Damage';

// Hero Vision 是否满层（层数达到 p01 上限且未过期）
function isHeroVisionFull(state, caster) {
  const s1 = caster.ssrFavSkills.skill1;
  const b  = state.buffs.find(b => b.name === HERO_VISION && b.unitId === caster.id && b.endTick > state.tick);
  return !!b && (b.stacks ?? 1) >= getSkillValue(s1, 1, s1._activeSkillLevel);
}

// Hero Vision 当前到期 tick（未生效为 0）
function heroVisionEndTick(state, caster) {
  const b = state.buffs.find(b => b.name === HERO_VISION && b.unitId === caster.id && b.endTick > state.tick);
  return b ? b.endTick : 0;
}

// 激光节拍：第 k 击 tick = 激光开始 + round(k × 发间)，按小数发间（2.5 tick）排定，避免整数取整累积误差。
// 返回 ≥ t 的最近一击 tick
function nextLaserTick(st, t) {
  const interval = TICK_RATE * 60 / LASER_RPM;
  let k = Math.max(0, Math.ceil((t - st.laplaceLaserStartTick) / interval));
  while (st.laplaceLaserStartTick + Math.round(k * interval) < t) k++;
  return st.laplaceLaserStartTick + Math.round(k * interval);
}

// 激光（Laplace Buster 切换武器）是否激活
function isLaserActive(state, caster) {
  const end = caster.skillState.weaponSwitchEndTick ?? 0;
  return end > 0 && state.tick <= end && caster.skillState.laplaceLaserEndTick === end;
}

export default {

  // ── Hero Vision（S1）
  // SSR group_id: 121001（skill_change_slot=1）
  // ■ Activates when attacking with Full Charge. Affects self.
  //   Hero Vision: Explosion Radius ▲ {p00}%, stacks up to {p01} time(s) and lasts for {p02} sec.
  // p00: [2.11,2.27,2.43,2.6,2.76,2.92,3.08,3.25,3.41,3.57]   — 爆炸范围：单敌模型无影响，不建模数值
  // p01: [5,...]
  // p02: [15,...]
  // p03: [1.05 … 1.78] / p04: [5,...] / p05: [15,...]        — 描述未引用的隐藏参数，效果不明，不建模
  //
  // Hero Vision 仅作为层数哨兵 buff（无数值字段），供爆裂判定「满层」使用。叠层刷新持续时间。
  // 激光期间不是全蓄力攻击，Hero Vision 不会被刷新。
  skill1: {
    groupId: 121001,
    triggers: [
      {
        on: 'FULL_CHARGE',
        handler(state, caster) {
          const s1 = caster.ssrFavSkills.skill1;
          const lv = s1._activeSkillLevel;
          pushBuff(state, { name: HERO_VISION, unitId: caster.id,
            stackLimit: getSkillValue(s1, 1, lv),
            endTick: state.tick + TICK_RATE * getSkillValue(s1, 2, lv) },
            { ...state._logCtx, partIdx: null });
        },
      },
    ],
  },

  // ── Hero Bomber（S2）
  // SSR group_id: 121002（skill_change_slot=2）
  // ■ Activates when hitting a target with Full Charge. Affects the target.
  //   Deals {p00}% of final ATK as additional damage.
  // ■ Activates when hitting the target's Parts. Affects the target's body.
  //   Deals {p01}% of final ATK as additional damage.
  // p00: [78.26,84.28,90.3,96.32,102.34,108.36,114.38,120.41,126.43,132.45]
  // p01: [8.73,9.4,10.08,10.75,11.42,12.09,12.76,13.44,14.11,14.78]
  //
  // 两段追加伤害均附带爆裂充能，每次命中 = 一发普攻充能（target_burst_energy_pershot），同 Neon: Vision Eye / Maiden: Ice Rose。
  skill2: {
    groupId: 121002,
    triggers: [
      // P1：全蓄力命中 → 追加 p00% 伤害
      {
        on: 'FULL_CHARGE',
        handler(state, caster) {
          if (state.enemyHp <= 0) return false;
          const s2 = caster.ssrFavSkills.skill2;
          fireSkillHit(state, caster, getSkillValue(s2, 0, s2._activeSkillLevel) / 100,
            getBuffSums(state, caster.id), 'S2 P1');
        },
      },
      // P2：命中零件 → 对本体追加 p01% 伤害（模拟器只建模零件核心：命中零件核心即命中零件）。
      //   激光期间 Hero Vision 满层时，零件命中的 S2 追加被 Burst P2 真实伤害取代（arca.live 实测，疑似游戏 bug），不触发。
      {
        on: 'SHOT_COUNT',
        handler(state, caster, ctx) {
          if (state.enemyHp <= 0 || !isPartsHit(state, ctx?.hitPart)) return false;
          if (isLaserActive(state, caster) && isHeroVisionFull(state, caster)) return false;
          const s2 = caster.ssrFavSkills.skill2;
          fireSkillHit(state, caster, getSkillValue(s2, 1, s2._activeSkillLevel) / 100,
            getBuffSums(state, caster.id), 'S2 P2');
        },
      },
    ],
  },

  // ── Laplace Buster（Burst）
  // SSR group_id: 111003（skill_change_slot=3）
  // ■ Affects self.
  //   Changes the weapon in use:
  //   First Damage: {p00}% of final ATK
  //   Normal Damage: {p01}% of final ATK
  //   Duration: {p02} sec
  //   Additional Effect 1: Pierce
  //   Additional Effect 2: Normal damage is applied as true damage when Hero Vision is fully stacked.
  //   Note: Unable to take cover while using Burst Skill.
  // ■ Affects the same enemy unit(s) when Hero Vision is fully stacked.
  //   Deals {p03}% of final ATK as true damage.
  // p00: [860.2,926.37,992.54,1058.71,1124.88,1191.04,1257.21,1323.38,1389.55,1455.72]
  // p01: [13.11,14.12,15.13,16.14,17.15,18.16,19.17,20.18,21.19,22.2]
  // p02: [10,...]
  // p03: [7.03,7.57,8.11,8.65,9.19,9.73,10.27,10.81,11.36,11.9]
  //
  // 「满层」逐击判定：激光期间 Hero Vision 不刷新，若施放前最后一次全蓄力距今较久，满层会在激光中途到期，
  // 此后 Normal Damage 恢复普通伤害、P2 真实伤害停止（Prydwen / 社区实测：Hero Vision 5s 时真实伤害只覆盖约 5s）。
  // 无法隐蔽：激光期间敌人隐藏 / 跳起时继续向空中开火（weaponSwitchNoCover），停火期间的击发落空，节拍不中断。
  burst: {
    groupId: 111003,
    triggers: [
      // P1：切换武器。First Damage 于进入全爆裂时击发，之后为激光 Normal Damage
      {
        on: 'BURST_SKILL_USE',
        handler(state, caster) {
          const fb  = caster.ssrFavSkills.burst;
          const lv  = fb._activeSkillLevel;
          const firstTick = state.tick + FULL_BURST_ENTRY_DELAY_TICKS;
          // 引擎切换期判定为 tick <= weaponSwitchEndTick（含两端）→ 取 end − 1，窗口为 [进入全爆裂, +p02 秒)
          const end = firstTick + TICK_RATE * getSkillValue(fb, 2, lv) - 1;
          Object.assign(caster.skillState, {
            weaponSwitchHitMult:         getSkillValue(fb, 0, lv) / 100,   // 首发 First Damage
            weaponSwitchType:            'MG',   // 非蓄力、非爆炸；射速由下方 chargeTick 驱动
            weaponSwitchEndTick:         end,
            weaponSwitchRoundsLeft:      0,
            // 任意正值使 RL 走切换蓄力路径；实际节拍由 SHOT_COUNT 按 nextLaserTick 改写 chargeTick
            weaponSwitchChargeTimeTicks: Math.ceil(TICK_RATE * 60 / LASER_RPM),
            weaponSwitchNoCover:         true,
            weaponSwitchUnlimitedAmmo:   true,
            weaponSwitchPierce:          true,
            weaponSwitchCoreRate:        0,      // First Damage 不可命中核心
            weaponSwitchLabel:           FIRST_DAMAGE_LABEL,
            laplaceLaserEndTick:         end,
            laplaceFirstDamagePending:   true,
            laplaceRechargeAfterSwitch:  true,
          });
          caster.reloadTick = 0;
          if (caster.ammoLeft <= 0) caster.ammoLeft = caster.maxAmmo;
          caster.chargeTick       = firstTick;
          caster.engineChargeTick = null;
        },
      },
      // P1：First Damage 击发后 → 切为激光 Normal Damage；Hero Vision 满层则 Normal Damage 转为真实伤害（至 Hero Vision 到期）。
      //     激光每击后按 1440 RPM 小数节拍排定下一击
      {
        on: 'SHOT_COUNT',
        partOverride: 0,
        handler(state, caster) {
          const st = caster.skillState;
          if (!isLaserActive(state, caster)) return false;
          if (!st.laplaceFirstDamagePending) {
            caster.chargeTick = nextLaserTick(st, state.tick + 1);
            return false;
          }
          st.laplaceFirstDamagePending = false;
          const fb = caster.ssrFavSkills.burst;
          Object.assign(st, {
            weaponSwitchHitMult:  getSkillValue(fb, 1, fb._activeSkillLevel) / 100,
            weaponSwitchCoreRate: null,          // 激光精准：非 SMG / SG 切换武器按 100% 核心率
            weaponSwitchLabel:    LASER_LABEL,
          });
          st.laplaceLaserStartTick = state.tick + LASER_START_DELAY_TICKS;
          caster.chargeTick        = st.laplaceLaserStartTick;
          if (!isHeroVisionFull(state, caster)) return false;
          pushBuff(state, { name: 'Laplace Buster (Normal Attack True Damage)', unitId: caster.id,
            normalAttackTrueDamage: true,
            endTick: Math.min(heroVisionEndTick(state, caster), st.weaponSwitchEndTick + 1) });
        },
      },
      // P2：激光每次命中，Hero Vision 满层 → 对同一目标追加 p03% 真实伤害（可暴击，不可核心、不可穿透）
      {
        on: 'SHOT_COUNT',
        partOverride: 1,
        handler(state, caster) {
          const st = caster.skillState;
          // First Damage 那一发不触发（P1 已在同一发中切为激光，用激光首击 tick 区分）
          if (st.laplaceFirstDamagePending || !isLaserActive(state, caster)) return false;
          if (state.tick < (st.laplaceLaserStartTick ?? Infinity)) return false;
          if (state.enemyHp <= 0 || !isHeroVisionFull(state, caster)) return false;
          const fb = caster.ssrFavSkills.burst;
          fireSkillHit(state, caster, getSkillValue(fb, 3, fb._activeSkillLevel) / 100,
            getBuffSums(state, caster.id), 'Burst P2', { isTrueDamage: true });
        },
      },
      // 无法隐蔽：敌人隐藏 / 跳起期间引擎不结算射击，到期未打出的击发视为射向空中（落空），
      //   chargeTick 顺延到下一节拍，使恢复可瞄准后按原节拍继续。
      // 切换武器结束 → 原武器（RL）重新前摇 + 蓄力后才打出下一发（激光的击发间隔不延续到 RL）
      {
        on: 'INTERVAL',
        opts: { seconds: 1 / TICK_RATE },
        partOverride: 0,
        handler(state, caster) {
          const st = caster.skillState;
          if (isLaserActive(state, caster) && !st.laplaceFirstDamagePending
              && caster.chargeTick < state.tick) {
            caster.chargeTick = nextLaserTick(st, state.tick);
          }
          if (!st.laplaceRechargeAfterSwitch || state.tick <= (st.laplaceLaserEndTick ?? 0)) return false;
          st.laplaceRechargeAfterSwitch = false;
          st.weaponSwitchCoreRate = null;
          st.weaponSwitchLabel    = null;
          caster.chargeTick       = state.tick + caster.foreswingTicks + caster.chargeTimeTicks;
          caster.engineChargeTick = null;
          return false;
        },
      },
    ],
  },
};
