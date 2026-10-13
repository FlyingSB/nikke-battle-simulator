/**
 * 界面多语言（简体中文 / English）。
 *
 * - 文案词典见 ./locales/zh.js、./locales/en.js，键名一一对应；
 * - 模板中通过 Alpine 魔法函数 $t('key', params) 取文案（main.js 注册），
 *   它读取 store 的响应式 lang 字段，切换语言时自动重渲染；
 * - 非响应式代码（sim-runner 报错、tooltip HTML 构建）用 t()，读取模块级当前语言。
 */
import zh from './locales/zh.js';
import en from './locales/en.js';

/** 可选语言（界面切换器使用） */
export const LANGS = [
  { code: 'zh', label: '简体中文' },
  { code: 'en', label: 'English' },
];

const DICTS            = { zh, en };
const DEFAULT_LANG     = 'zh';
const LANG_STORAGE_KEY = 'nikke-sim-lang';

let _current = DEFAULT_LANG;

/** 规范化语言代码：未知值回退到默认语言 */
export function normalizeLang(lang) {
  return Object.hasOwn(DICTS, lang ?? '') ? lang : DEFAULT_LANG;
}

/** 读取上次保存的界面语言 */
export function loadSavedLang() {
  try {
    return normalizeLang(localStorage.getItem(LANG_STORAGE_KEY));
  } catch {
    return DEFAULT_LANG;
  }
}

/** 设置模块级当前语言并持久化（store.setLang 调用） */
export function setCurrentLang(lang) {
  _current = normalizeLang(lang);
  try {
    localStorage.setItem(LANG_STORAGE_KEY, _current);
  } catch (err) {
    console.error('界面语言保存失败（仅本次生效）:', err);
  }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = _current === 'zh' ? 'zh-CN' : 'en';
    document.title = translate(_current, 'app.title');
  }
}

export function getCurrentLang() {
  return _current;
}

/**
 * 按指定语言取文案并插值；缺失键依次回退到中文词典、键名本身。
 * @param {string} lang
 * @param {string} key
 * @param {Record<string, *>} [params]
 * @returns {string}
 */
export function translate(lang, key, params) {
  const s = DICTS[lang]?.[key] ?? DICTS[DEFAULT_LANG][key] ?? key;
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (Object.hasOwn(params, k) ? String(params[k]) : m));
}

/** 按模块级当前语言取文案（非响应式场景使用） */
export function t(key, params) {
  return translate(_current, key, params);
}

/** 词典键集合（测试用：校验各语言键名一致） */
export function dictKeys(lang) {
  return Object.keys(DICTS[lang] ?? {});
}
