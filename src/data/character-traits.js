// ─── 角色静态属性覆盖 ────────────────────────────────────────────────────────

/**
 * CDN 数据中武器类型有误时在此覆盖。
 * @type {Record<number, { weaponType?: string }>}
 */
export const CHARACTER_TRAITS = {
  354: { squad: 'Aegis' },  // Mast: Romantic Maid
  355: { squad: 'Aegis' },  // Anchor: Innocent Maid
};

export function getCharacterTraits(resourceId) {
  if (resourceId == null) return null;
  return CHARACTER_TRAITS[resourceId] ?? null;
}
