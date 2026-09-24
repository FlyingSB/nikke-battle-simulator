/**
 * CDN 数据清单 — 游戏打补丁时更新这些 URL。
 * 来源：sg-tools-cdn.blablalink.com（通过 blablalink.com/shiftyspad 发现）
 *
 * 自动更新 MANIFEST_VERSION：运行 `node scripts/update-manifest.js`（只更新版本号，不更新 URL 表）
 * 手动更新（DATA_URLS / CUBE_URLS / FAVORITE_ITEM_URLS）：
 *   1. 浏览器打开 blablalink.com/shiftyspad
 *   2. DevTools → Network → 过滤 "sg-tools-cdn"
 *   3. 将变更的哈希替换为新值
 *
 * 单角色数据 URL 由 getRoleDataUrl(resource_id)（src/data/blablalink-url.js）动态计算，
 * 覆盖 characters.json 中列出的全部角色（已验证 189 个角色全部正确）。
 * resource_id 跨补丁稳定 — 只有 CDN 哈希会变。
 */
export const CDN_BASE = 'https://sg-tools-cdn.blablalink.com';

/** 共享的静态数据文件 */
export const DATA_URLS = {
  // 角色花名册 — 英文名（定期扫描新角色）
  characters:       `${CDN_BASE}/yl-57/hd-03/1bf030193826e243c2e195f951a4be00.json`,

  // 进阶 / 升级表
  levels:           `${CDN_BASE}/dk-23/ch-40/cd943005e95b00c950d3e8941078afdd.json`,
  attractive:       `${CDN_BASE}/qe-66/cb6bd83fc9f961e0975612b760fbef8e.json`,
  recycleRoom:      `${CDN_BASE}/eu-96/258f853112b1d6f69d1508e12918ff3b.json`,

  // 角色经验 / 等级进阶表（CharacterLevel + SynchroLevel，556 条记录）
  charLevels:       `${CDN_BASE}/dv-15/e8b9e7f748f8734b2848842b47bf1cb2.json`,

  // 装备 & 魔方（yu-75 = 实时抓取的哈希，替代 md-16）
  equipment:        `${CDN_BASE}/yu-75/6677291d48d5ac3804d5e7a194df7085.json`,
  harmonyCubes:     `${CDN_BASE}/xo-77/ym-98/bdeb2eac49311bbd09d360044441330e.json`,

  // 装备词条效果（每个词条的 state_effect_id_list；ids 10/11/20 已废弃）
  equipmentEffects: `${CDN_BASE}/bl-25/e76520be5092c3795fa92b8555f3e1c3.json`,

  // Buff 系统
  buffEffects:      `${CDN_BASE}/vv-42/b46c877b8d7077e4eba2f3e924550a25.json`,
};

export const BATTLE_DATA_KEYS = [
  'characters', 'levels', 'attractive', 'recycleRoom',
  'charLevels', 'equipment', 'harmonyCubes', 'equipmentEffects', 'buffEffects',
];

/**
 * 单个魔方详情 URL，以 resource_id 为键。
 * 1-6 号位使用 resource_id = 10000+order；7-11 号位使用不规则的 id。
 */
export const CUBE_URLS = {
  10001: `${CDN_BASE}/mj-86/qt-96/8b7ee39ea6d8561aeb7684b1dfef44de.json`, // Assault Cube
  10002: `${CDN_BASE}/oq-56/vo-38/4961ff342f503875a27b49b38ed18890.json`, // Onslaught Cube
  10003: `${CDN_BASE}/qx-26/gm-26/c30913a016dcc8bd2f8159eb25293d09.json`, // Resilience Cube
  10004: `${CDN_BASE}/te-95/rk-14/e92075611a09bd6e518eb0ad02ca945d.json`, // Bastion Cube
  10005: `${CDN_BASE}/vl-65/ci-02/a8f5d8b4ff861eece4548d78a1c72160.json`, // Adjutant Cube
  10006: `${CDN_BASE}/xs-35/ng-89/ea11880e5dac7f7951cf53cd661f8d50.json`, // Wingman Cube
  11001: `${CDN_BASE}/zz-05/ye-77/7466e67e5867d77428acc9ac8e8a431e.json`, // Quantum Cube
  12001: `${CDN_BASE}/su-37/ua-53/f63f8eeef7b05b2613e565c88411aa85.json`, // Endurance Cube
  12002: `${CDN_BASE}/oi-58/ed-33/12be15ca4cc0a1b2bb7ea592f4d1cb54.json`, // Tempering Cube
  13001: `${CDN_BASE}/cg-74/jc-65/0ea6471506cb50c8b11956e79519e53f.json`, // Vigor Cube
  13002: `${CDN_BASE}/mb-88/tf-45/04d816e85354fe34be7be98a58ff2a6d.json`, // Healing Cube
  10007: `${CDN_BASE}/sw-97/zz-09/eb3faca311e044eb47e0e0ae86bce17d.json`, // Destruction Cube
  10008: `${CDN_BASE}/jk-60/kx-96/130b31a68768adfe7ae41aee848b91bf.json`, // Piercing Cube
  10009: `${CDN_BASE}/qp-28/pb-21/65d2d6c8ff11d9bf1aac3f0f2e53ca8e.json`, // Assist Cube
  10010: `${CDN_BASE}/lr-30/vv-84/5cd65f71ac1a7c1218a0763f2256eb7c.json`, // Rupture Cube
  10012: `${CDN_BASE}/ny-00/gt-72/58a1a48262e4cbc2ef8d527309f6da01.json`, // Stealth Cube
  10013: `${CDN_BASE}/qf-69/lo-14/b05e40e21e8c8cff46d594859d1ba4e8.json`, // Diffusion Cube
};

/**
 * UI 展示用的魔方名称（英文），以 resource_id 为键。
 * 顺序与游戏内魔方列表一致。
 */
export const CUBE_NAMES = {
  10001: 'Assault Cube',
  10002: 'Onslaught Cube',
  10003: 'Resilience Cube',
  10004: 'Bastion Cube',
  10005: 'Adjutant Cube',
  10006: 'Wingman Cube',
  10007: 'Destruction Cube',
  10008: 'Piercing Cube',
  10009: 'Assist Cube',
  10010: 'Rupture Cube',
  10012: 'Stealth Cube',
  10013: 'Diffusion Cube',
  11001: 'Quantum Cube',
  12001: 'Endurance Cube',
  12002: 'Tempering Cube',
  13001: 'Vigor Cube',
  13002: 'Healing Cube',
};

/**
 * 珍藏品 URL，以 resource_id 为键。
 * ID 规则：100XYY，其中 X = 武器（1=AR，2=MG，3=RL，4=SG，5=SMG，6=SR 武器），YY=01(R)，02(SR)
 */
export const FAVORITE_ITEM_URLS = {
  100101: `${CDN_BASE}/xi-40/gs-37/90fc5b000210b9f648c6ada3e6b0c8b5.json`, // Cooking Commander Doll (AR-R)
  100102: `${CDN_BASE}/zp-10/rq-25/5763044efd73f25e4011a74f02e672ba.json`, // Cooking Commander Doll Ltd. (AR-SR)
  100201: `${CDN_BASE}/tt-22/ye-76/8024a2eaff2922fa1306e2701411db21.json`, // Shopping Commander Doll (MG-R)
  100202: `${CDN_BASE}/wa-91/jc-64/fefcd9391e78283cddb5f6c4c4c46090.json`, // Shopping Commander Doll Ltd. (MG-SR)
  100301: `${CDN_BASE}/qe-04/pq-16/23a570f9eeaf3314208d69fd14266a37.json`, // Exercising Commander Doll (RL-R)
  100302: `${CDN_BASE}/sl-73/ao-04/6e36a834da103913d711bcedb14ae1cf.json`, // Exercising Commander Doll Ltd. (RL-SR)
  100401: `${CDN_BASE}/mp-85/hc-55/86ca497f8b61cd0ba149ee75aeac1c36.json`, // Battling Commander Doll (SG-R)
  100402: `${CDN_BASE}/ow-55/sa-43/f651bea53ebaaa2b510a82b843832890.json`, // Battling Commander Doll Ltd. (SG-SR)
  100501: `${CDN_BASE}/ja-67/yo-94/96be2385b765de1bb693c5d8b257ab2c.json`, // Coffee Commander Doll (SMG-R)
  100502: `${CDN_BASE}/lh-37/jm-82/45d094194b9c9037940f91d5fe2a3b9e.json`, // Coffee Commander Doll Ltd. (SMG-SR)
  100601: `${CDN_BASE}/fl-49/qa-34/d6b2d7d74cc43bc2e214ddefb1cb5e30.json`, // Napping Commander Doll (SR-weapon-R)
  100602: `${CDN_BASE}/hs-19/ay-22/dfee9fe38f21aead258654194bf7d509.json`, // Napping Commander Doll Ltd. (SR-weapon-SR)
  // SSR 专属珍藏品（角色特化；提升全部三个技能等级）
  200701: `${CDN_BASE}/qf-35/xj-78/2cef2b4f5f105b32637e4fa0cb9b2b36.json`, // Antique Compass (Helm SSR)
  200801: `${CDN_BASE}/mq-17/ov-18/324e104bfcec45d056cbd6ee6f12a6ee.json`, // Villain Figurine (Drake SSR)
  201401: `${CDN_BASE}/ym-06/wl-16/2a2ddcb790f7df98815ab1dfc36a20b9.json`, // Central Government Special Medal (Privaty SSR)
  201801: `${CDN_BASE}/th-09/oh-73/f99196b54c350c000bd96c4fd8ca2730.json`, // Precious Masks (Phantom SSR)
  201901: `${CDN_BASE}/dz-83/ft-13/833a86913db43192888345b92b2a8e9e.json`, // Planter We Made Together (Flora SSR)
  202001: `${CDN_BASE}/fe-77/eb-14/7378cab1e0489e6d42d90807739188ea.json`, // Signet Ring (Rosanna SSR)
  202101: `${CDN_BASE}/bp-59/bq-00/3fa9f3ca6bfc68d9119313a765995f1d.json`, // Commemorative Keychain (Sugar SSR)
};

/** manifest 变更时递增此版本号，以使 localStorage 缓存失效 */
export const MANIFEST_VERSION = '20260924';
