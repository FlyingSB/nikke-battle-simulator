/**
 * Cinderella 单人模拟 — 统计普通攻击次数与换弹次数。
 *
 * 使用 sim-defaults.mjs 中的默认设置（180s，DEF 100，动态距离阶段）。
 * 队伍：仅 Cinderella（RL，Step3）。无 B1/B2，爆裂无法完成，全程只有普通攻击。
 *
 * Run: node scripts/sim-cinderella-solo.mjs
 */

import { loadNikkeData, loadStaticData, loadFavItemData, loadCubeData } from './lib/nikke-cache.mjs';
import { setData }                     from '../src/data/loader.js';
import { computeFinalStats }           from '../src/engine/stats.js';
import { simulate }                    from '../src/engine/battle.js';
import {
  SYNCHRO_LEVEL,
  RESEARCH,
  DEFAULT_ENEMY,
  ENEMY_PHASES,
  DURATION_SECONDS,
  CINDERELLA_DEF,
} from './sim-defaults.mjs';

// ENEMY_PHASES 转换：秒 → tick（60 tick/s），仅保留起始点
const phases = ENEMY_PHASES.map(p => ({
  startTick: Math.round(p.startSec * 60),
  zone: p.distance,
}));

async function main() {
  // 加载静态数据
  const statics = ['levels', 'attractive', 'recycleRoom', 'charLevels', 'equipment', 'harmonyCubes', 'equipmentEffects'];
  for (const key of statics) setData(key, await loadStaticData(key));

  const char = CINDERELLA_DEF;
  const nd   = await loadNikkeData(char.resourceId, char.name);
  const cd   = await loadCubeData(char.cubeId);
  const fd   = await loadFavItemData(char.favItemId);

  const baseAmmo = nd.shot_detail?.max_ammo ?? 30;

  const { ammoPct = 0, atkPct = 0, ...directOpts } = char.equipPct;
  const bonusAmmo = Math.round(baseAmmo * ammoPct);

  const slotBase = {
    resourceId:   char.resourceId,
    classType:    char.classType,
    corporation:  char.corporation,
    element:      char.element,
    weaponType:   char.weaponType,
    burstStep:    char.burstStep,
    grade:        char.grade,
    core:         char.core,
    bondLevel:    char.bondLevel,
    skills:       [10, 10, 10],
    cube:         { resourceId: char.cubeId, level: char.cubeLevel ?? 15 },
    favoriteItem: { resourceId: char.favItemId, level: char.favLevel, rare: 'SR' },
    equipment: {
      head:  { classReq: char.classType, tier: 'T10', level: 5, options: [false,false,false] },
      torso: { classReq: char.classType, tier: 'T10', level: 5, options: [false,false,false] },
      arms:  { classReq: char.classType, tier: 'T10', level: 5, options: [false,false,false] },
      legs:  { classReq: char.classType, tier: 'T10', level: 5, options: [false,false,false] },
    },
    equipOptions: { ...directOpts, atkPct, bonusAmmo },
    _nikkeData:   nd,
    _cubeData:    cd,
    _favItemData: fd,
  };

  const stats = computeFinalStats(slotBase, SYNCHRO_LEVEL, RESEARCH);

  const chargeTimeTicks = Math.round((nd.shot_detail?.charge_time ?? 0) / 100 * 60);
  const reloadTicks     = Math.round((nd.shot_detail?.reload_time ?? 18000) / 100 * 60);

  const config = {
    squad: [{
      characterId:        char.resourceId,
      name:               char.name,
      classType:          char.classType,
      element:            char.element,
      weaponType:         char.weaponType,
      burstStep:          char.burstStep,
      level:              SYNCHRO_LEVEL,
      _computedStats:     stats,
      _favItemData:       fd,
      _cubeData:          cd,
      favoriteItem:       { resourceId: char.favItemId, level: char.favLevel },
      baseAmmo,
      fullChargeDamage:   nd.shot_detail?.full_charge_damage ?? 10000,
      reloadTicks,
      burstEnergyPerShot: nd.shot_detail?.burst_energy_pershot ?? 500,
      chargeTimeTicks,
      burstSkillCooltime: Math.round((nd.ulti_skill_detail?.skill_cooltime ?? 4000) / 100 * 60),
      shotDamageMult:     nd.shot_detail?.damage != null ? nd.shot_detail.damage / 10000 : null,
      rateOfFire:         nd.shot_detail?.rate_of_fire ?? 0,
    }],
    enemy: {
      ...DEFAULT_ENEMY,
      phases,
    },
    duration: DURATION_SECONDS,
  };

  const result = simulate(config);
  const u = result.units[0];

  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Cinderella 单人模拟（${DURATION_SECONDS}s，默认配置）`);
  console.log('═══════════════════════════════════════════════════════════════\n');
  console.log(`  普通攻击次数（hitCount）  ：${u.hitCount}`);
  console.log(`  换弹次数    （reloadCount）：${u.reloadCount}`);
  console.log(`\n  弹药容量：${baseAmmo} + ${bonusAmmo} = ${baseAmmo + bonusAmmo}`);
  console.log(`  CDN charge_time：${nd.shot_detail?.charge_time ?? '未知'} cs  →  ${chargeTimeTicks} tick`);
  console.log(`  CDN reload_time：${nd.shot_detail?.reload_time ?? '未知'} cs  →  ${reloadTicks} tick`);
  console.log(`\n  模拟时长：${result.timeSeconds.toFixed(1)}s   爆裂次数：${result.burstCount}`);
}

main().catch(err => { console.error(err); process.exit(1); });
