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
  // grouped-ROUND：词条按相同 pct 分组 round，再换算回比例（battle.js 按 round(baseAmmo × pct) 消费）
  const equipMaxAmmoFlat = Math.round(baseAmmo * ammoPct);
  const equipMaxAmmoPct  = equipMaxAmmoFlat / baseAmmo;

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
    equipOptions: { ...directOpts, atkPct, equipMaxAmmoPct },
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
      _nikkeData:         nd,
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
      // DOWN_Charge 型 + 前后摇（与 store.js 的换算一致；缺失时会被当成 UP 型/默认 10t，节奏全错）
      isDownCharge:       nd.shot_detail?.input_type === 'DOWN_Charge',
      foreswingTicks:     Math.round((nd.shot_detail?.spot_first_delay ?? 16.67) / 100 * 60),
      backswingTicks:     Math.round(((nd.shot_detail?.maintain_fire_stance > 0
                            ? nd.shot_detail.maintain_fire_stance
                            : (nd.shot_detail?.spot_last_delay ?? 16.67))) / 100 * 60),
    }],
    enemy: {
      ...DEFAULT_ENEMY,
      phases,
    },
    duration: DURATION_SECONDS,
    hitLog: true,   // 开启逐发明细，供 33s 窗口计数
  };

  const result = simulate(config);
  const u = result.units[0];

  // 实测基准（2026-07-17）：开场 33s 攻击 88 次，含 1 次换弹、2 次全蓄力，无外部蓄速/换弹 buff
  // 引擎战斗时长固定 180s（config.duration 不被消费），故用事件流按 tick 截取 33s 窗口
  const hits33    = result.hitLog.filter(e => e.label === 'normal_shot' && e.tick <= 33 * 60).length;
  const reloads33 = result.log.filter(e => e.type === 'reload' && e.tick <= 33 * 60).length;

  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Cinderella 单人模拟（${DURATION_SECONDS}s，默认配置）`);
  console.log('═══════════════════════════════════════════════════════════════\n');
  console.log(`  普通攻击次数（hitCount）  ：${u.hitCount}`);
  console.log(`  换弹次数    （reloadCount）：${u.reloadCount}`);
  console.log(`\n  33s 窗口：普攻 ${hits33} 次 / 换弹 ${reloads33} 次（实测基准 88 / 1）`);

  // DEBUG_TIMELINE=1 时输出 33s 内逐发 tick 与换弹 tick，用于与实测节奏对齐
  if (process.env.DEBUG_TIMELINE) {
    const shots   = result.hitLog.filter(e => e.label === 'normal_shot' && e.tick <= 33 * 60).map(e => e.tick);
    const reloads = result.log.filter(e => e.type === 'reload' && e.tick <= 33 * 60).map(e => e.tick);
    console.log(`\n  shots  : ${shots.join(',')}`);
    console.log(`  reloads: ${reloads.join(',')}`);
  }
  console.log(`\n  弹药容量：${baseAmmo} + ${equipMaxAmmoFlat} = ${baseAmmo + equipMaxAmmoFlat}`);
  console.log(`  CDN charge_time：${nd.shot_detail?.charge_time ?? '未知'} cs  →  ${chargeTimeTicks} tick`);
  console.log(`  CDN reload_time：${nd.shot_detail?.reload_time ?? '未知'} cs  →  ${reloadTicks} tick`);
  console.log(`\n  模拟时长：${result.timeSeconds.toFixed(1)}s   爆裂次数：${result.burstCount}`);
}

main().catch(err => { console.error(err); process.exit(1); });
