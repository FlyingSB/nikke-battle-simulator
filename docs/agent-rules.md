# AI 代理硬规则（Claude Code / Codex 共用）

> 这些规则来自用户历次纠正，违反过就会出事实错误或丢用户数据。
> 用户新提出的纠正追加到这里（注明日期与原因），不要只写进某一方的私有记忆。
> 原始出处：Claude 私有记忆（2026-11-20 迁入）。

## 角色名与文件归属

1. **角色名必须用游戏内完整名称，任何场合不得简写**（回复、文档、注释、变量、提交信息）。
   同一故事人物有多个完全不同的角色：「Anis」≠「Anis: Sparkling Summer」，「Diesel」≠「Diesel: Winter Sweets」。带冒号后缀的必须连后缀写全。
2. **resource_id ↔ 角色名必须查证**：先查 `docs/data-catalog.md` 或技能文件头 `// Character:` 注释，绝不凭记忆、buff 前缀推断。
   曾错映射：18 是 Neon: Vision Eye（非 Helm）；75 是 Diesel: Winter Sweets（非 Dorothy）；470 是 Red Hood（≠ Rapi: Red Hood）；390 是 Zwei（非 Maxwell）。
3. **查找角色 resource_id**：读 `src/data/manifest.js` 的 `DATA_URLS.characters`，一次 fetch 全量花名册后按 `name_localkey.name` 过滤；不要逐个试 ID，不要硬编码 URL。

## 技能建模

4. **技能文件头注释**：`src/data/skills/<id>.js` 在 import 之后、`export default` 之前必须有
   `// Character: <完整角色名>  (resource_id: <id>)`；有 SSR 珍藏品再加 `// SSR 珍藏品: <名>（id: <collectible_id>）`。
5. **命名规则**：伤害标签 / 效果段标签 / Buff 名按 `docs/skill-modeling-guide.md` 四级规则；多目标用 `pushBuff({ unitIds })`，动态倍率传 `multiplier`；**自定义命名必须在回复中列表汇报**（角色、技能、原文依据、命名）。
6. **建模后同步 `docs/data-catalog.md`**：新增 / 更新角色行。
7. **data-catalog「已审核」列只有用户能改**：新行一律填 ❌，已有行（✔️ 或 ❌）不得改动，即使重新建模也不行。
8. **「rifles / 步枪」仅指 AR**，不含 SR（`weaponType === 'AR'`）。武器类别泛称含义不明时先问用户。
9. **SG 弹丸数**：「Number of pellets ▲」不改 `shotDamageMult`，只追踪叠层；伤害增加来自同时触发的 `normalAttackDamagePct` 类效果。
   但爆裂充能按弹丸计：一次射击 N 发弹丸全中 → 充能 `N × target_burst_energy_pershot`（引擎已实现）。
10. **「Expends ammo. Amount: N round(s)」只是计数**：只加 `state.totalAmmoFired`（切换武器用 `weaponSwitchAmmoCountPerShot`），弹匣实际仍只扣 1 发，不改 `ammoLeft`。
    切换武器给出的弹匣容量是**基础值**，改 `unit.baseAmmo` 后 `recalcMaxAmmo`（参照 515.js `setWeaponBaseAmmo`）。

## 浏览器与用户数据

11. 浏览器只开 `http://127.0.0.1:5500`（不是 localhost，存储不互通）；**永远不要自己启动任何开发服务器**。
12. 改 `src/ui/store.js` 读档 / init 路径时**每次保存都必须可运行**：按「先定义 → 后引用」顺序保存，或一次改完。
    原因：2026-10-19 半成品保存触发 Live Server 刷新，读档抛错后自动存档把 localStorage `nikke-sim-v1` 里的用户队伍覆盖成默认值。
    动手前可先备份 `localStorage['nikke-sim-v1']`。

## 领域速查

- 装备词条 ID：`option_id = state_effect_id_prefix × 100 + level`（1–15），数值表 `src/data/static/equipmentEffects.csv`；
  `bonusAmmo` 按 `Math.round(baseAmmo × pct)`，`defFlat` 实为百分比。映射见 `src/data/account-loader.js` 的 `_OPTION_MAP`。
- 默认模拟参数固化在 `scripts/sim-defaults.mjs`；账号设置从 `dev/config.json` → `account_file` 读取（`dev/` 私密不入库）。
