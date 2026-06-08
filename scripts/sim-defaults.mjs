/**
 * 模拟默认参数 — 所有模拟脚本共用。
 *
 * 每次运行"模拟"时采用此配置，仅需变更 squad 中的角色定义。
 *
 * 全局设定（2026-04-29）：
 *   同步器级别：609
 *   研究等级：通用 280，火力型/防御型/辅助型 224，
 *             Elysion/Missilis/Tetra 212，Abnormal 211，Pilgrim 206
 *   战斗时长：180s（3 分钟）
 *   敌人：DEF 100，Iron 属性，含核心，动态距离（详见 ENEMY_PHASES）
 */

import { maxGeneralResearchLevel } from '../src/data/models.js';

// ─── 同步器 & 研究 ────────────────────────────────────────────────────────────

export const SYNCHRO_LEVEL = 609;

export const RESEARCH = {
  general:   maxGeneralResearchLevel(SYNCHRO_LEVEL),  // 280
  attacker:  224,   // 火力型
  defender:  224,   // 防御型
  supporter: 224,   // 辅助型
  ELYSION:   212,
  MISSILIS:  212,
  TETRA:     212,
  PILGRIM:   206,
  ABNORMAL:  211,
};

// ─── 敌人基础属性 ─────────────────────────────────────────────────────────────

export const DEFAULT_ENEMY = {
  maxHp:    1e12,     // 实质无限血量，跑满时限
  def:      100,
  element:  'Iron',
  type:     'Boss',
  hasCore:  true,
  distance: 'NEAR',  // 初始距离；完整时间轴见 ENEMY_PHASES
};

// 敌人行动时间轴（HIDDEN 阶段无法被攻击）
export const ENEMY_PHASES = [
  { startSec:   0,      endSec:  35,     distance: 'NEAR'   },
  { startSec:  35,      endSec:  36.86,  distance: 'HIDDEN' },
  { startSec:  36.86,   endSec:  72,     distance: 'NEAR'   },
  { startSec:  72,      endSec:  73.86,  distance: 'HIDDEN' },
  { startSec:  73.86,   endSec: 112,     distance: 'MID'    },
  { startSec: 112,      endSec: 113.86,  distance: 'HIDDEN' },
  { startSec: 113.86,   endSec: 150,     distance: 'MID'    },
  { startSec: 150,      endSec: 151.86,  distance: 'HIDDEN' },
  { startSec: 151.86,   endSec: 180,     distance: 'NEAR'   },
];

// ─── 战斗时长 ─────────────────────────────────────────────────────────────────

export const DURATION_SECONDS = 180;

// ─── 角色定义：Classic 队伍 ───────────────────────────────────────────────────

// Little Mermaid — Grade 3 Core 0 Bond 40  Resilience Cube lv15  SR fav lv15
export const LITTLE_MERMAID_DEF = {
  resourceId:  513,
  name:        'Little Mermaid',
  classType:   'Supporter',
  corporation: 'PILGRIM',
  element:     'Wind',
  weaponType:  'SMG',
  burstStep:   'Step1',
  grade:       3,
  core:        0,
  bondLevel:   40,
  cubeId:      10003,
  cubeLevel:   15,
  favItemId:   100502,
  favLevel:    15,
  equipPct: {
    elementDmgPct: 0.3871,
    atkPct:        0.09,
    ammoPct:       1.8214,
    hitRatePct:    0.0688,
    critRatePct:   0.0528,
    defPct:        0.09,
  },
};

// Crown — Grade 3 Core 1 Bond 40  Bastion Cube lv15  SSR fav lv15
export const CROWN_DEF = {
  resourceId:  330,
  name:        'Crown',
  classType:   'Defender',
  corporation: 'PILGRIM',
  element:     'Iron',
  weaponType:  'MG',
  burstStep:   'Step2',
  grade:       3,
  core:        1,
  bondLevel:   40,
  cubeId:      10004,
  cubeLevel:   15,
  favItemId:   100202,
  favLevel:    15,
  equipPct: {
    elementDmgPct:  0.1655,
    atkPct:         0.2151,
    ammoPct:        1.1321,
    chargeSpeedPct: 0.0925,
    critRatePct:    0.0571,
    critDamagePct:     0.27,
  },
};

// Rapi: Red Hood — Grade 3 Core 3 Bond 40  Bastion Cube lv15  SSR fav lv15
export const RAPI_DEF = {
  resourceId:  16,
  name:        'Rapi: Red Hood',
  classType:   'Attacker',
  corporation: 'ELYSION',
  element:     'Fire',
  weaponType:  'MG',
  burstStep:   'Step3',
  grade:       3,
  core:        3,
  bondLevel:   40,
  cubeId:      10004,
  cubeLevel:   15,
  favItemId:   100202,
  favLevel:    15,
  equipPct: {
    elementDmgPct: 0.9842,
    atkPct:        0.5289,
    ammoPct:       1.8625,
    critDamagePct:    0.0664,
  },
};

// Scarlet: Black Shadow — Grade 3 Core 0 Bond 40  Resilience Cube lv15  SR fav lv15
export const SBS_DEF = {
  resourceId:  225,
  name:        'Scarlet: Black Shadow',
  classType:   'Attacker',
  corporation: 'PILGRIM',
  element:     'Wind',
  weaponType:  'RL',
  burstStep:   'Step3',
  grade:       3,
  core:        0,
  bondLevel:   40,
  cubeId:      10003,
  cubeLevel:   15,
  favItemId:   100302,
  favLevel:    15,
  equipPct: {
    elementDmgPct: 0.9281,
    atkPct:        0.5501,
    ammoPct:       1.2143,
    chargeDmgPct:  0.097,
    critRatePct:   0.0435,
  },
};

// Helm — Grade 3 Core 6 Bond 30  Adjutant Cube lv15  SSR fav lv2 (技能10)  canBurst=false
export const HELM_DEF = {
  resourceId:       352,
  name:             'Helm',
  classType:        'Attacker',
  corporation:      'ELYSION',
  element:          'Water',
  weaponType:       'SR',
  burstStep:        'Step3',
  grade:            3,
  core:             6,
  bondLevel:        30,
  cubeId:           10005,
  cubeLevel:        15,
  favItemId:        200701,
  favLevel:         2,
  ssrFavSkillLevel: 10,
  canBurst:         false,
  equipPct: {
    elementDmgPct: 0.9562,
    atkPct:        0.1659,
    ammoPct:       1.8533,
    chargeDmgPct:  0.194,
  },
};

// ─── 角色定义：Team 2 ─────────────────────────────────────────────────────────

// Liter — Grade 3 Core 7 Bond 40  Resilience Cube lv15  SR fav lv5
export const LITER_DEF = {
  resourceId:  82,
  name:        'Liter',
  classType:   'Supporter',
  corporation: 'MISSILIS',
  element:     'Iron',
  weaponType:  'SMG',
  burstStep:   'Step1',
  grade:       3,
  core:        7,
  bondLevel:   40,
  cubeId:      10003,
  cubeLevel:   15,
  favItemId:   100502,
  favLevel:    5,
  equipPct: {
    elementDmgPct:  0.2356,
    atkPct:         0.1181,
    ammoPct:        0.6893,
    chargeSpeedPct: 0.0492,
    chargeDmgPct:   0.1181,
    critRatePct:    0.1713,
  },
};

// Mast: Romantic Maid — Grade 3 Core 2 Bond 40  Bastion Cube lv15  SSR fav lv15
export const MAST_DEF = {
  resourceId:  354,
  name:        'Mast: Romantic Maid',
  classType:   'Supporter',
  corporation: 'ELYSION',
  element:     'Water',
  weaponType:  'MG',
  burstStep:   'Step2',
  grade:       3,
  core:        2,
  bondLevel:   40,
  cubeId:      10004,
  cubeLevel:   15,
  favItemId:   100202,
  favLevel:    15,
  equipPct: {
    elementDmgPct: 0.2356,
    atkPct:        0.1181,
    chargeDmgPct:  0.2362,
    hitRatePct:    0.2362,
    critRatePct:   0.0571,
  },
};

// Anchor: Innocent Maid — Grade 3 Core 1 Bond 40  Resilience Cube lv15  SR fav lv5
export const ANCHOR_DEF = {
  resourceId:  355,
  name:        'Anchor: Innocent Maid',
  classType:   'Supporter',
  corporation: 'ELYSION',
  element:     'Water',
  weaponType:  'RL',
  burstStep:   'Step2',
  grade:       3,
  core:        1,
  bondLevel:   40,
  cubeId:      10003,
  cubeLevel:   15,
  favItemId:   100302,
  favLevel:    5,
  equipPct: {
    ammoPct:     1.3786,
    hitRatePct:  0.1181,
    critRatePct: 0.1142,
    critDamagePct:  0.3288,
  },
};

// Liberalio — Grade 3 Core 0 Bond 40  Resilience Cube lv15  SR fav lv15  免疫技能加速
export const LIBERALIO_DEF = {
  resourceId:             262,
  name:                   'Liberalio',
  classType:              'Attacker',
  corporation:            'PILGRIM',
  element:                'Wind',
  weaponType:             'SR',
  burstStep:              'Step3',
  grade:                  3,
  core:                   0,
  bondLevel:              40,
  cubeId:                 10003,
  cubeLevel:              15,
  favItemId:              100602,
  favLevel:               15,
  immuneSkillChargeSpeed: true,
  equipPct: {
    elementDmgPct:  0.5358,
    atkPct:         0.187,
    ammoPct:        1.1321,
    chargeSpeedPct: 0.0484,
    critRatePct:    0.0699,
  },
};

// ─── 角色定义：Team 3 ─────────────────────────────────────────────────────────

// Moran — Grade 3 Core 3 Bond 40  Resilience Cube lv15  SR fav lv15
export const MORAN_DEF = {
  resourceId:  281,
  name:        'Moran',
  classType:   'Defender',
  corporation: 'TETRA',
  element:     'Electric',
  weaponType:  'AR',
  burstStep:   'Step2',
  grade:       3,
  core:        3,
  bondLevel:   40,
  cubeId:      10003,
  cubeLevel:   15,
  favItemId:   100102,
  favLevel:    15,
  equipPct: {
    elementDmgPct:  0.2356,
    ammoPct:        0.6893,
    chargeSpeedPct: 0.0492,
    hitRatePct:     0.1181,
    critRatePct:    0.1142,
    critDamagePct:     0.1644,
  },
};

// Nayuta — Grade 2 Core 0 Bond 40  Resilience Cube lv15  SR fav lv5
export const NAYUTA_DEF = {
  resourceId:  223,
  name:        'Nayuta',
  classType:   'Supporter',
  corporation: 'PILGRIM',
  element:     'Wind',
  weaponType:  'SMG',
  burstStep:   'Step3',
  grade:       2,
  core:        0,
  bondLevel:   40,
  cubeId:      10003,
  cubeLevel:   15,
  favItemId:   100502,
  favLevel:    5,
  equipPct: {
    elementDmgPct: 0.8721,
    atkPct:        0.3951,
    chargeDmgPct:  0.104,
    critRatePct:   0.0469,
  },
};

// Cinderella — Grade 3 Core 1 Bond 40  Bastion Cube lv15  SR fav lv15  技能 10/10/10
// 装备词条：属性伤害 +92.82%，攻击力 +40.21%，弹匣 +85.37%+40.17%，暴击伤害 +7.62%
export const CINDERELLA_DEF = {
  resourceId:  511,
  name:        'Cinderella',
  classType:   'Attacker',
  corporation: 'PILGRIM',
  element:     'Electric',
  weaponType:  'RL',
  burstStep:   'Step3',
  grade:       3,
  core:        1,
  bondLevel:   40,
  cubeId:      10004,   // Bastion Cube
  cubeLevel:   15,
  favItemId:   100501,  // SR 珍藏品（通用）
  favLevel:    15,
  equipPct: {
    elementDmgPct: 0.9282,
    atkPct:        0.4021,
    ammoPct:       0.8537 + 0.4017,  // 1.2554 合计
    critDamagePct:    0.0762,
  },
};

// Anis: Sparkling Summer — Grade 0 Core 0 Bond 40  Resilience Cube lv15  SR fav lv15
export const ANIS_SS_DEF = {
  resourceId:  15,
  name:        'Anis: Sparkling Summer',
  classType:   'Supporter',
  corporation: 'TETRA',
  element:     'Electric',
  weaponType:  'SG',
  burstStep:   'StepFull',
  grade:       0,
  core:        0,
  bondLevel:   40,
  cubeId:      10003,
  cubeLevel:   15,
  favItemId:   100402,
  favLevel:    15,
  equipPct: {
    elementDmgPct: 0.9421,
    atkPct:        0.1587,
    hitRatePct:    0.1799,
    critRatePct:   0.0537,
    critDamagePct:    0.1252,
  },
};

// Maiden: Ice Rose — Grade 0 Core 0 Bond 40  Resilience Cube lv15  SR fav lv5
export const MAIDEN_DEF = {
  resourceId:  183,
  name:        'Maiden: Ice Rose',
  classType:   'Defender',
  corporation: 'ELYSION',
  element:     'Electric',
  weaponType:  'RL',
  burstStep:   'StepFull',
  grade:       0,
  core:        0,
  bondLevel:   40,
  cubeId:      10003,
  cubeLevel:   15,
  favItemId:   100302,
  favLevel:    5,
  equipPct: {
    elementDmgPct:  0.816,
    atkPct:         0.4091,
    chargeSpeedPct: 0.0257,
    chargeDmgPct:   0.0759,
    critRatePct:    0.023,
  },
};
