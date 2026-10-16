/**
 * 双枪（shot_detail.muzzle_count === 2）回归 — 纯函数，无 CDN、无文件 I/O。合成单位 + initBattle / tick。
 *
 * 规则：双枪角色普通攻击武器伤害系数 ×2（SG 弹丸数不变、每弹丸系数 ×2）；
 *   切换武器默认同样 ×2，技能以 skillState.weaponSwitchDualGun = false 排除（如 Zwei 爆裂双重命中）。
 *   命中日志记录 dualGunMult，供伤害明细列出「双枪 ×2」。
 *
 * Covers:
 *   D1 — SMG：muzzle_count 2 的 hitMult / 伤害为单枪 2 倍，命中行带 dualGunMult = 2
 *   D2 — 单枪（muzzle_count 1）：无 dualGunMult
 *   D3 — SG：弹丸数不变，每弹丸系数 ×2
 *   D4 — 切换武器：默认 ×2；weaponSwitchDualGun = false 时 ×1
 *   D5 — 充能：非 SG 双枪每次攻击充能 ×2；SG 双枪仅按弹丸数；weaponSwitchDualGun = false 时 ×1
 *
 * Run: node scripts/tests/test-dual-gun.mjs
 */

import { initBattle, tick } from '../../src/engine/battle.js';
import { eq, near, section, summary } from '../lib/test-harness.mjs';

const ENEMY = { maxHp: 1e15, def: 0, element: 'Iron', type: 'Boss', hasCore: false, distance: 50 };

let _nextId = 93000;

/** 合成单位；muzzle 控制 _nikkeData.shot_detail.muzzle_count */
function unit(muzzle, overrides = {}) {
  return {
    characterId:              _nextId++,
    name:                     `DualGun-Test-${muzzle}`,
    element:                  'Iron',
    weaponType:               'SMG',
    burstStep:                'Step3',
    _nikkeData:               { shot_detail: { muzzle_count: muzzle } },
    _computedStats:           { atk: 100_000, hp: 1_000_000, def: 1_000, critRate: 0, critDmg: 0 },
    targetBurstEnergyPerShot: 100,
    burstEnergyPerShot:       100,
    burstSkillCooltime:       0,
    coreDmgIncrement:         0,
    fullChargeDamage:         10000,
    reloadFraction:           1.0,
    shotDamageMult:           0.05,
    rateOfFire:               1440,
    baseAmmo:                 120,
    reloadTicks:              120,
    ...overrides,
  };
}

/** 跑到首发普通射击命中行（含切换武器射击：普通射击行均带 ammoBeforeShot） */
function firstShot(u, setup = null) {
  const state = initBattle({ squad: [u], enemy: ENEMY, hitLog: true });
  if (setup) setup(state, state.squad[0]);
  for (let t = 0; t < 120 && !state.hitLog.some(h => h.ammoBeforeShot !== undefined); t++) tick(state);
  return state.hitLog.find(h => h.ammoBeforeShot !== undefined);
}

section('D1–D2 — SMG 双枪 vs 单枪');
{
  const single = firstShot(unit(1));
  const dual   = firstShot(unit(2));
  near('单枪 hitMult 0.05', single?.hitMult, 0.05, 1e-9);
  near('双枪 hitMult 0.10', dual?.hitMult, 0.10, 1e-9);
  eq('双枪 dualGunMult = 2', dual?.dualGunMult, 2);
  eq('单枪无 dualGunMult', single?.dualGunMult, undefined);
  near('双枪伤害 = 单枪 × 2', dual?.damage, single?.damage * 2, 1);
}

section('D3 — SG 双枪：弹丸数不变，每弹丸系数 ×2');
{
  const sg = { weaponType: 'SG', shotDamageMult: 1.0, shotCount: 10, rateOfFire: 90, baseAmmo: 9 };
  const single = firstShot(unit(1, sg));
  const dual   = firstShot(unit(2, sg));
  eq('发射弹丸数仍为 10', dual?.firedPellets, 10);
  near('每弹丸系数 0.2（单枪 0.1）', dual?.pelletHitMult, 0.2, 1e-9);
  near('单枪每弹丸系数 0.1', single?.pelletHitMult, 0.1, 1e-9);
  eq('SG 双枪 dualGunMult = 2', dual?.dualGunMult, 2);
}

section('D4 — 切换武器：默认 ×2，weaponSwitchDualGun = false 排除');
{
  const switchTo = (dualGun) => (state, u) => Object.assign(u.skillState, {
    weaponSwitchHitMult: 0.5, weaponSwitchType: 'SMG', weaponSwitchEndTick: Infinity,
    ...(dualGun === false ? { weaponSwitchDualGun: false } : {}),
  });
  const dflt = firstShot(unit(2), switchTo());
  const off  = firstShot(unit(2), switchTo(false));
  near('切换武器默认 ×2 → 1.0', dflt?.hitMult, 1.0, 1e-9);
  eq('切换武器 dualGunMult = 2', dflt?.dualGunMult, 2);
  near('weaponSwitchDualGun=false → 0.5', off?.hitMult, 0.5, 1e-9);
  eq('排除后无 dualGunMult', off?.dualGunMult, undefined);
}

section('D5 — 充能：非 SG 双枪每次攻击 ×2，SG 双枪不乘');
{
  // 首发命中行 gaugeAfter = 本发充能（开局槽为 0）
  const single = firstShot(unit(1));
  const dual   = firstShot(unit(2));
  eq('单枪 SMG 充能 100', single?.gaugeAfter, 100);
  eq('双枪 SMG 充能 200', dual?.gaugeAfter, 200);

  const sg = { weaponType: 'SG', shotDamageMult: 1.0, shotCount: 10, rateOfFire: 90, baseAmmo: 9 };
  eq('SG 双枪充能 = 单发 × 弹丸数（不乘双枪）', firstShot(unit(2, sg))?.gaugeAfter, 1000);

  const switchOff = (state, u) => Object.assign(u.skillState, {
    weaponSwitchHitMult: 0.5, weaponSwitchType: 'SMG', weaponSwitchEndTick: Infinity, weaponSwitchDualGun: false,
  });
  eq('weaponSwitchDualGun=false → 充能 ×1', firstShot(unit(2), switchOff)?.gaugeAfter, 100);
}

summary('DualGun');
