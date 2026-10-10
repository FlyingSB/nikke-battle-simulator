/**
 * 战斗日志「游戏文本」的显示翻译：角色名、技能名、具名效果、Buff 名、目标列。
 *
 * 引擎与日志行内部一律保留原始键（英文技能名 / 引擎中文常量），筛选与 tooltip 查找都依赖它们；
 * 这里只在渲染时把文本翻译成当前界面语言：
 *   - 中文界面：按「英文 → 简体」名称表替换角色名、技能名、具名效果名，
 *     Buff 名括号内的类型词（docs/skill-modeling-guide.md §4.2）按 BUFF_TYPE_ZH 翻译；
 *   - 英文界面：只需把引擎输出的中文常量（全体队友 / 敌人 / 爆裂槽 …）译成英文。
 * 名称表中查不到的文本保持原样（英文）。
 */
import { translate } from './i18n.js';

/** Buff 名括号内的类型词 → 简体（与 skill-modeling-guide §4.2 类型词表对应） */
export const BUFF_TYPE_ZH = {
  'ATK':                  '攻击力',
  'Attack Damage':        '攻击伤害',
  'Crit Damage':          '暴击伤害',
  'Charge Damage':        '蓄力伤害',
  'Core Damage':          '核心伤害',
  'Elem Adv Damage':      '优越代码攻击伤害',
  'Elem Adv':             '优越代码',
  'Pierce Damage':        '穿透伤害',
  'Distributed Damage':   '分摊伤害',
  'Sustained Damage':     '持续伤害',
  'True Damage':          '无视防御力伤害',
  'Parts Damage':         '零件伤害',
  'Explosion Damage':     '发射体爆炸伤害',
  'Attachment Damage':    '发射体附着伤害',
  'Sequential Damage':    '依次攻击伤害',
  'Normal Attack Damage': '普通攻击伤害',
  'Crit Rate':            '暴击率',
  'Charge Speed':         '蓄力速度',
  'Reload Speed':         '换弹速度',
  'Max Ammo':             '最大装弹数',
  'Max HP':               '最大体力',
  'Attack Speed':         '攻击速度',
  'Hit Rate':             '命中率',
  'DEF Down':             '防御力减少',
  'DEF':                  '防御力',
  'Burst Gauge':          '爆裂进度',
  'Life Steal':           '恢复相当于攻击伤害',
  'Outgoing Healing':     '给予的体力恢复量',
  'Incoming Healing':     '获得体力恢复量',
  'Pierce':               '穿透',
  'Pellets':              '弹丸',
  'MG Heating up':         '机枪预热',
  'Damage Taken':         '受到伤害',
  'Burst CD':             '爆裂技能冷却',
};

/**
 * 引擎内置的英文 Buff 名（battle.js initBattle 推入的永久 buff）
 * 及技能文件中跨角色通用的命中标签名 → 简体（用词取自台服描述）
 */
const ENGINE_NAMES_ZH = {
  'OL Ammo':               '装备词条（最大装弹数）',
  'Fav Ammo':              '珍藏品（最大装弹数）',
  'Cube':                  '魔方',
  'Cube Reload':           '魔方（装填速度）',
  'Projectile Attachment': '发射体附着',
  'Projectile Explosion':  '发射体爆炸',
};

/**
 * 引擎输出的中文常量 → 界面词典键。两种界面语言都经词典显示，
 * 因此中文显示用词（如「爆裂进度」）在 locales/zh.js 中调整，无需改引擎。
 */
const ENGINE_TOKENS = {
  '全体队友': 'target.allAllies',
  '敌人':     'target.enemy',
  '爆裂槽':   'target.burstGauge',
  '掩体':     'target.cover',
  '普通攻击': 'log.normal',
};

const _isWordChar = ch => ch != null && /[A-Za-z0-9]/.test(ch);

/**
 * 按条目表（已按英文长度降序）做「整词」替换：匹配处前后不能紧贴字母或数字。
 * @param {string} text
 * @param {Array<[string, string]>} entries
 */
function _replaceWords(text, entries) {
  let out = '';
  let i = 0;
  outer: while (i < text.length) {
    if (!_isWordChar(text[i - 1])) {
      for (const [en, zh] of entries) {
        if (text.startsWith(en, i) && !_isWordChar(text[i + en.length])) {
          out += zh;
          i += en.length;
          continue outer;
        }
      }
    }
    out += text[i++];
  }
  return out;
}

const _sortByLength = entries => entries.sort((a, b) => b[0].length - a[0].length);
const BUFF_TYPE_ENTRIES = _sortByLength(Object.entries(BUFF_TYPE_ZH));

/**
 * 构建「英文 → 简体」名称表（角色名、技能名、具名效果名）。
 * @param {Iterable<[string, string]>} pairs  重复的英文键以先出现者为准
 * @returns {{ entries: Array<[string, string]>, memo: Map<string, string> }}
 */
export function createNameMap(pairs) {
  const map = new Map(Object.entries(ENGINE_NAMES_ZH));
  for (const [en, zh] of pairs) {
    if (en && zh && en !== zh && !map.has(en)) map.set(en, zh);
  }
  return { entries: _sortByLength([...map.entries()]), memo: new Map() };
}

/** 中文界面：替换名称，再把括号内的类型词译为中文并改用全角括号（全角括号前不留空格） */
function _toZh(text, nameMap) {
  const named = _replaceWords(text, nameMap.entries);
  return named.replace(/\s*\(([^()]*)\)/g, (_, inner) => `（${_replaceWords(inner, BUFF_TYPE_ENTRIES)}）`);
}

/** 英文界面：翻译引擎中文常量（含「掩体（…）」「AR 友军」等组合形式） */
function _toEn(text) {
  if (ENGINE_TOKENS[text]) return translate('en', ENGINE_TOKENS[text]);
  const weaponAllies = text.match(/^(\S+) 友军$/);
  if (weaponAllies) return translate('en', 'target.weaponAllies', { w: weaponAllies[1] });
  return text
    .replace(/^掩体（/, `${translate('en', 'target.cover')} (`)
    .replace(/（/g, ' (').replace(/）/g, ')').replace(/、/g, ', ');
}

/**
 * 翻译一段日志游戏文本（技能标签、Buff 名、角色名、目标项）。
 * @param {string} text
 * @param {'zh'|'en'} lang
 * @param {{ entries: Array<[string,string]>, memo: Map<string,string> }|null} nameMap  中文界面需要
 * @returns {string}
 */
export function displayGameText(text, lang, nameMap) {
  if (!text) return text ?? '';
  if (lang !== 'zh') return _toEn(text);
  if (ENGINE_TOKENS[text]) return translate('zh', ENGINE_TOKENS[text]);
  if (!nameMap) return text;
  let hit = nameMap.memo.get(text);
  if (hit === undefined) {
    hit = _toZh(text, nameMap);
    nameMap.memo.set(text, hit);
  }
  return hit;
}
