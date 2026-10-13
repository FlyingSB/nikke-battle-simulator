// 界面图标素材路径（素材缓存于 src/assets/icons/，源自 blablalink.com）
// 引擎内部键（英文）→ 图标文件；未登记的键返回 null，由模板隐藏对应图标。

const DIR = 'src/assets/icons/';

/** 敌人代码选择器的显示顺序：燃烧 - 风压 - 铁甲 - 电击 - 水冷 */
export const ELEMENT_ORDER = ['Fire', 'Wind', 'Iron', 'Electric', 'Water'];

export const CLASS_ORDER = ['Attacker', 'Defender', 'Supporter'];
export const CORP_ORDER  = ['ELYSION', 'MISSILIS', 'TETRA', 'PILGRIM', 'ABNORMAL'];

const ELEMENT_FILES = {
  Fire: 'code-fire.png', Water: 'code-water.png', Wind: 'code-wind.png',
  Electric: 'code-electronic.png', Iron: 'code-iron.png',
};
const WEAPON_FILES = {
  AR: 'weapon-assault_rifle.png', SMG: 'weapon-sub_machine_gun.png', SG: 'weapon-shot_gun.png',
  SR: 'weapon-sniper_rifle.png', RL: 'weapon-rocket_launcher.png', MG: 'weapon-machine_gun.png',
};
const CLASS_FILES = {
  Attacker: 'job-attacker.png', Defender: 'job-defender.png', Supporter: 'job-supporter.png',
};
const CORP_FILES = {
  ELYSION: 'corp-elysion.webp', MISSILIS: 'corp-missilis.webp', TETRA: 'corp-tetra.webp',
  PILGRIM: 'corp-pilgrim.webp', ABNORMAL: 'corp-abnormal.webp',
};
// AllStep（如 Red Hood）使用专属爆裂图标
const BURST_FILES = {
  Step1: 'burst-1.png', Step2: 'burst-2.png', Step3: 'burst-3.png', AllStep: 'burst-p.png',
};

const pick = (table, key) => (table[key] ? DIR + table[key] : null);

export const elementIcon = (e) => pick(ELEMENT_FILES, e);
export const weaponIcon  = (w) => pick(WEAPON_FILES, w);
export const classIcon   = (c) => pick(CLASS_FILES, c);
export const corpIcon    = (c) => pick(CORP_FILES, c);
export const burstIcon   = (b) => pick(BURST_FILES, b);
