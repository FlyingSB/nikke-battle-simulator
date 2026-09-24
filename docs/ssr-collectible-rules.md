# SSR 珍藏品技能建模规则

## 规则概述

凡是技能已被 SSR 珍藏品替换的角色，模拟器**仅建模 SSR 升级后的版本**，不保留基础版本作为回退。
相应地，模拟时该角色**必须持有对应的满级（Lv15）SSR 珍藏品**，否则点击"开始模拟"将报错并拒绝运行。

## 背景

SSR 专属珍藏品（resource_id `200XXX` / `201XXX` / `202XXX`）会替换角色全部三个技能槽位（`skill_change_slot = 1/2/3`）。  
替换后的技能与基础版本在数值和触发条件上均不同。

若同时建模 SSR 版与基础版（通过 `caster.ssrFavSkills?.skill1 ?? caster.rawSkill1` 回退），会导致：

- 未配置 SSR 珍藏品时悄无声息降为基础版数值，与实战不符；
- 仅 SSR 版才有的触发条件（如 Zwei S1 的普攻叠层）在回退路径中无法正确模拟。

因此 SSR 角色的技能文件只建模 SSR 版，前置校验在启动时强制要求珍藏品配置正确。

---

## 受影响角色清单

下表列出所有已建模 SSR 技能的角色。模拟时必须为这些角色配置对应的满级（Lv15）SSR 珍藏品。

| 角色 | resource_id | SSR 珍藏品名称 | 珍藏品 resource_id |
|------|:-----------:|--------------|:-----------------:|
| Miranda | 32 | Sheet of Paper | 200601 |
| Drake | 101 | Villain Figurine | 200801 |
| Sugar | 140 | Commemorative Keychain | 202101 |
| Privaty | 170 | Central Government Special Medal | 201401 |
| Tove | 192 | Fire Starter | 201101 |
| Rosanna | 280 | Signet Ring | 202001 |
| Moran | 281 | Peony Hairpin | 201701 |
| Helm | 352 | Antique Compass | 200701 |
| Zwei | 390 | Four-Leaf Clover Bookmark | 201501 |
| Flora | 411 | Planter We Made Together | 201901 |
| Phantom | 580 | Precious Masks | 201801 |

---

## 代码实现

### 1. 校验映射表（`src/ui/store.js`）

`SSR_FAV_BY_CHAR` 常量（约第 80 行）记录 `角色 resource_id → 珍藏品 resource_id` 的对应关系。  
`SSR_FAV_MAX_ITEM_LEVEL = 2` 为 SSR 珍藏品满级的档位编号（UI 中 0=Lv5 / 1=Lv10 / 2=Lv15）。

### 2. 运行时校验（`src/ui/store.js` → `runSimulate()`）

在模拟开始前，对每个激活槽位执行以下检查：

1. 若角色在 `SSR_FAV_BY_CHAR` 中有条目，但未持有对应 SSR 珍藏品 → `alert` 报错并 `return`；
2. 若持有的 SSR 珍藏品等级档位 < `SSR_FAV_MAX_ITEM_LEVEL`（即未达 Lv15）→ `alert` 报错并 `return`。

### 3. 技能文件约定（`src/data/skills/*.js`）

新建 SSR 角色的技能文件时：

- **不**提供 `?? caster.rawSkill1` 形式的基础技能回退；
- 直接从 `caster.ssrFavSkills?.skill1` 取值（引擎层已保证其存在）；
- 文件头注释中声明所对应的 SSR 珍藏品 id 和名称（参见现有文件格式）。

---

## 新增 SSR 角色时的更新清单

每当为新角色建模 SSR 技能时，必须同步更新以下三处：

1. **`src/ui/store.js` → `SSR_FAV_BY_CHAR`**：添加 `角色id: 珍藏品id` 条目及注释；
2. **`docs/data-catalog.md` → 已建模技能表**：在角色名后标注 `（SSR：珍藏品名称）`；
3. **本文档（`docs/ssr-collectible-rules.md`）→ 受影响角色清单**：追加新角色行。
