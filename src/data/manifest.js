/**
 * CDN data manifest — update these URLs when the game patches.
 * Source: sg-tools-cdn.blablalink.com (discovered from blablalink.com/shiftyspad)
 *
 * To find updated URLs:
 *   1. Open blablalink.com/shiftyspad in browser
 *   2. DevTools → Network → filter "sg-tools-cdn"
 *   3. Replace changed hashes below
 */
export const CDN_BASE = 'https://sg-tools-cdn.blablalink.com';

export const DATA_URLS = {
  // Core battle data
  characters:      `${CDN_BASE}/jz-26/ww-14/c4619ec83335bcfd7b23e43600520dc7.json`,
  characterDetail: `${CDN_BASE}/gh-63/78500850d16bc195da282203c61ea37e.json`,
  levels:          `${CDN_BASE}/dk-23/ch-40/cd943005e95b00c950d3e8941078afdd.json`,
  equipment:       `${CDN_BASE}/md-16/02d7f979df58efa0aa8dbd18de91a916.json`,
  harmonyCubes:    `${CDN_BASE}/xo-77/ym-98/bdeb2eac49311bbd09d360044441330e.json`,

  // Progression bonuses
  attractive:      `${CDN_BASE}/qe-66/cb6bd83fc9f961e0975612b760fbef8e.json`,
  recycleRoom:     `${CDN_BASE}/eu-96/258f853112b1d6f69d1508e12918ff3b.json`,

  // Supporting data
  buffEffects:     `${CDN_BASE}/vv-42/b46c877b8d7077e4eba2f3e924550a25.json`,
  costumes:        `${CDN_BASE}/kw-85/7548a00f7a945550ddf0958a80abce46.json`,
  characterRes:    `${CDN_BASE}/ug-00/452950b7851009edecb261bf5ee0c236.json`,

  // Misc (not needed for battle sim but useful)
  stages:          `${CDN_BASE}/xx-97/b32816a11f83865b09bcf95e67ca83ae.json`,
  quests:          `${CDN_BASE}/jl-07/im-07/9077b4012dd276c806041e9744382323.json`,
  seasons:         `${CDN_BASE}/rm-58/a7f993363fe3e2df8a4a7e579decc872.json`,
};

// Only these are required for battle simulation
export const BATTLE_DATA_KEYS = [
  'characters',
  'characterDetail',
  'levels',
  'equipment',
  'harmonyCubes',
  'attractive',
  'recycleRoom',
  'buffEffects',
];

// Version hash — update when manifest changes to bust cache
export const MANIFEST_VERSION = '20260318';
