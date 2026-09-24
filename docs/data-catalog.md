# 数据资源目录

收录所有从 CDN 下载并存储在项目中的静态数据，以及已完成建模的角色技能。

---

## CDN 静态数据

CDN 来源：`sg-tools-cdn.blablalink.com`（通过 blablalink.com/shiftyspad 发现）。  
URL 哈希随游戏补丁变化，版本号记录在 [`src/data/manifest.js`](../src/data/manifest.js)（当前版本：`20260924`）。

### 共享游戏数据

存储路径：[`src/data/static/`](../src/data/static/)

| 文件 | 内容说明 |
|------|---------|
| [`characters.json`](../src/data/static/characters.json) | 角色花名册（英文名，201 个角色） |
| [`levels.json`](../src/data/static/levels.json) | 进阶 / 升级表 |
| [`attractive.json`](../src/data/static/attractive.json) | 吸引力系统数据 |
| [`recycleRoom.json`](../src/data/static/recycleRoom.json) | 回收室数据 |
| [`charLevels.json`](../src/data/static/charLevels.json) | 角色经验 / 等级进阶表（CharacterLevel + SynchroLevel，556 条记录） |
| [`equipment.json`](../src/data/static/equipment.json) | 装备数据 |
| [`harmonyCubes.json`](../src/data/static/harmonyCubes.json) | 魔方数据 |
| [`equipmentEffects.json`](../src/data/static/equipmentEffects.json) | 装备词条效果（每个词条的 state_effect_id_list） |
| [`buffEffects.json`](../src/data/static/buffEffects.json) | Buff 系统数据 |

### 装备词条数值表

文件：[`src/data/static/equipmentEffects.csv`](../src/data/static/equipmentEffects.csv)

`equipmentEffects.json` 是 CDN 原始数据，仅含 `state_effect_id_list`；  
`equipmentEffects.csv` 是手工整理的 T10 词条数值表，供引擎读取具体数值。词条仅存在于 T10 装备，T1–T9 无词条槽位。

**CSV 列定义**

| 列名 | 含义 |
|------|------|
| `T10词条` | 游戏内英文词条名 |
| `中文翻译` | 中文对照名 |
| `function_type` | 引擎识别键（account-loader.js `_OPTION_MAP` 中的 key） |
| `state_effect_id_prefix` | 词条 ID 前缀（7 位 option_id = prefix × 100 + level） |
| `等级1`…`等级15` | 各强化等级的数值（带 `%`，引擎存储时 ÷100 转为小数） |

**option_id 编码规则**

```
option_id = state_effect_id_prefix × 100 + level   (level 1–15)
```

例：prefix=70011（暴击率），level=7 → option_id = 7001107

**function_type → 引擎 key 映射**

| function_type | 引擎 key | prefix | 等级 1 | 等级 15 |
|---------------|---------|--------|-------|--------|
| `IncElementDmg` | `elementDmgPct` | 70005 | 9.54% | 29.16% |
| `StatAccuracyCircle` | `hitRatePct` | 70006 | 4.77% | 14.63% |
| `StatAmmoLoad` | `ammoPct` | 70007 | 27.84% | 85.37% |
| `StatAtk` | `atkPct` | 70008 | 4.77% | 14.63% |
| `StatChargeDamage` | `chargeDmgPct` | 70009 | 4.77% | 14.63% |
| `StatChargeTime` | `chargeSpeedPct` | 70010 | 1.98% | 6.09% |
| `StatCritical` | `critRatePct` | 70011 | 2.30% | 7.07% |
| `StatCriticalDamage` | `critDamagePct` | 70012 | 6.64% | 20.36% |
| `StatDef` | `defPct` | 70013 | 4.77% | 14.63% |

> **引擎特殊处理**  
> `ammoPct`：以小数 pct 存储，应用为 `Math.round(baseAmmo × pct)`，不直接相加。  
> `defPct`：实际是 pct，应用为 `def += Math.round(def × pct)`。  
> 相关文件：`src/data/account-loader.js`（`_OPTION_GROUPS` / `_OPTION_MAP`）、`src/engine/stats.js`。

---

### 魔方详情数据

存储路径：[`src/data/static/cubes/`](../src/data/static/cubes/)（文件名为 `{resource_id}.json`）  
加载器优先读取本地文件，缺失时回退 CDN；CDN URL 由 [`blablalink-url.js`](../src/data/blablalink-url.js) `getCubeUrl(id)` 生成。名称与 resource_id 映射见 [`src/data/manifest.js`](../src/data/manifest.js) → `CUBE_NAMES`。

`id` 为 JSON 内 `"id"` 字段（传给 `getCubeUrl`），`文件` 为本地缓存文件名（resource_id）。

| id | 文件 | 魔方名称 |
|----|------|---------|
| 1000301 | [`10001.json`](../src/data/static/cubes/10001.json) | Assault Cube |
| 1000302 | [`10002.json`](../src/data/static/cubes/10002.json) | Onslaught Cube |
| 1000303 | [`10003.json`](../src/data/static/cubes/10003.json) | Resilience Cube |
| 1000304 | [`10004.json`](../src/data/static/cubes/10004.json) | Bastion Cube |
| 1000305 | [`10005.json`](../src/data/static/cubes/10005.json) | Adjutant Cube |
| 1000306 | [`10006.json`](../src/data/static/cubes/10006.json) | Wingman Cube |
| 1000307 | [`11001.json`](../src/data/static/cubes/11001.json) | Quantum Cube |
| 1000308 | [`13001.json`](../src/data/static/cubes/13001.json) | Vigor Cube |
| 1000309 | [`12001.json`](../src/data/static/cubes/12001.json) | Endurance Cube |
| 1000310 | [`13002.json`](../src/data/static/cubes/13002.json) | Healing Cube |
| 1000311 | [`12002.json`](../src/data/static/cubes/12002.json) | Tempering Cube |
| 1000312 | [`10009.json`](../src/data/static/cubes/10009.json) | Assist Cube |
| 1000313 | [`10007.json`](../src/data/static/cubes/10007.json) | Destruction Cube |
| 1000314 | [`10008.json`](../src/data/static/cubes/10008.json) | Piercing Cube |
| 1000315 | [`10010.json`](../src/data/static/cubes/10010.json) | Rupture Cube |

### 珍藏品数据

存储路径：[`src/data/static/favorites/`](../src/data/static/favorites/)  
加载器优先读取本地文件，缺失时回退 CDN；CDN URL 由 [`blablalink-url.js`](../src/data/blablalink-url.js) `getFavoriteItemUrl(id)` 生成。  
全部珍藏品（含 SSR）均已本地缓存。

ID 规则：`100XYY`，X = 武器类型（1=AR / 2=MG / 3=RL / 4=SG / 5=SMG / 6=SR），YY = `01`（R）/ `02`（SR）。  
SSR 专属珍藏品（`200XXX` / `201XXX` / `202XXX`）与角色绑定，提升全部三个技能等级。

| 文件 | 珍藏品名称 | 类型 |
|------|-----------|------|
| [`100101.json`](../src/data/static/favorites/100101.json) | Cooking Commander Doll | AR · R |
| [`100102.json`](../src/data/static/favorites/100102.json) | Cooking Commander Doll Ltd. | AR · SR |
| [`100201.json`](../src/data/static/favorites/100201.json) | Shopping Commander Doll | MG · R |
| [`100202.json`](../src/data/static/favorites/100202.json) | Shopping Commander Doll Ltd. | MG · SR |
| [`100301.json`](../src/data/static/favorites/100301.json) | Exercising Commander Doll | RL · R |
| [`100302.json`](../src/data/static/favorites/100302.json) | Exercising Commander Doll Ltd. | RL · SR |
| [`100401.json`](../src/data/static/favorites/100401.json) | Battling Commander Doll | SG · R |
| [`100402.json`](../src/data/static/favorites/100402.json) | Battling Commander Doll Ltd. | SG · SR |
| [`100501.json`](../src/data/static/favorites/100501.json) | Coffee Commander Doll | SMG · R |
| [`100502.json`](../src/data/static/favorites/100502.json) | Coffee Commander Doll Ltd. | SMG · SR |
| [`100601.json`](../src/data/static/favorites/100601.json) | Napping Commander Doll | SR-weapon · R |
| [`100602.json`](../src/data/static/favorites/100602.json) | Napping Commander Doll Ltd. | SR-weapon · SR |
| [`200101.json`](../src/data/static/favorites/200101.json) | Toy Train Set（Diesel SSR） | SSR |
| [`200201.json`](../src/data/static/favorites/200201.json) | Gamekid Evolution（Exia SSR） | SSR |
| [`200301.json`](../src/data/static/favorites/200301.json) | Beloved Pillow（Frima SSR） | SSR |
| [`200401.json`](../src/data/static/favorites/200401.json) | Hero Trilogy BD（Laplace SSR） | SSR |
| [`200501.json`](../src/data/static/favorites/200501.json) | First Phone and Phone Book（Viper SSR） | SSR |
| [`200601.json`](../src/data/static/favorites/200601.json) | Sheet of Paper（Miranda SSR） | SSR |
| [`200701.json`](../src/data/static/favorites/200701.json) | Antique Compass（Helm SSR） | SSR |
| [`200801.json`](../src/data/static/favorites/200801.json) | Villain Figurine（Drake SSR） | SSR |
| [`200901.json`](../src/data/static/favorites/200901.json) | Lover Mug（Milk SSR） | SSR |
| [`201001.json`](../src/data/static/favorites/201001.json) | Police Notebook（Poli SSR） | SSR |
| [`201101.json`](../src/data/static/favorites/201101.json) | Fire Starter（Tove SSR） | SSR |
| [`201201.json`](../src/data/static/favorites/201201.json) | Music Notebook（Julia SSR） | SSR |
| [`201301.json`](../src/data/static/favorites/201301.json) | Practice Shoes（Bay SSR） | SSR |
| [`201401.json`](../src/data/static/favorites/201401.json) | Central Government Special Medal（Privaty SSR） | SSR |
| [`201501.json`](../src/data/static/favorites/201501.json) | Four-Leaf Clover Bookmark（Zwei SSR） | SSR |
| [`201601.json`](../src/data/static/favorites/201601.json) | Metal Pendant（Centi SSR） | SSR |
| [`201701.json`](../src/data/static/favorites/201701.json) | Peony Hairpin（Moran SSR） | SSR |
| [`201801.json`](../src/data/static/favorites/201801.json) | Precious Masks（Phantom SSR） | SSR |
| [`201901.json`](../src/data/static/favorites/201901.json) | Planter We Made Together（Flora SSR） | SSR |
| [`202001.json`](../src/data/static/favorites/202001.json) | Signet Ring（Rosanna SSR） | SSR |
| [`202101.json`](../src/data/static/favorites/202101.json) | Commemorative Keychain（Sugar SSR） | SSR |

---

## 角色表

数据文件存储路径：[`src/data/static/nikke/`](../src/data/static/nikke/)（角色 CDN roledata，文件名为 `resource_id.json`）  
技能文件存储路径：[`src/data/skills/`](../src/data/skills/)（导出默认对象，包含 `skill1` / `skill2` / `burstSkill` 三个技能处理器）

| 已审核 | 角色 | 数据（文件） | 技能（文件） |
|-------|------|------------|------------|
| ❌ | Anis: Sparkling Summer | [`15.json`](../src/data/static/nikke/15.json) | [`15.js`](../src/data/skills/15.js) |
| ✔️ | Rapi: Red Hood | [`16.json`](../src/data/static/nikke/16.json) | [`16.js`](../src/data/skills/16.js) |
| ❌ | Anis: Star | [`17.json`](../src/data/static/nikke/17.json) | [`17.js`](../src/data/skills/17.js) |
| ❌ | Neon: Vision Eye | [`18.json`](../src/data/static/nikke/18.json) | [`18.js`](../src/data/skills/18.js) |
| ✔️ | Miranda | [`32.json`](../src/data/static/nikke/32.json) | [`32.js`](../src/data/skills/32.js) |
| ✔️ | D: Killer Wife | [`43.json`](../src/data/static/nikke/43.json) | [`43.js`](../src/data/skills/43.js) |
| ✔️ | Brid: Silent Track | [`73.json`](../src/data/static/nikke/73.json) | [`73.js`](../src/data/skills/73.js) |
| ❌ | Soline: Frost Ticket | [`74.json`](../src/data/static/nikke/74.json) | [`74.js`](../src/data/skills/74.js) |
| ✔️ | Diesel: Winter Sweets | [`75.json`](../src/data/static/nikke/75.json) | [`75.js`](../src/data/skills/75.js) |
| ✔️ | Liter | [`82.json`](../src/data/static/nikke/82.json) | [`82.js`](../src/data/skills/82.js) |
| ❌ | Drake | [`101.json`](../src/data/static/nikke/101.json) | [`101.js`](../src/data/skills/101.js) |
| ✔️ | Maxwell | [`102.json`](../src/data/static/nikke/102.json) | [`102.js`](../src/data/skills/102.js) |
| ❌ | Laplace: Ultimate Hero | [`103.json`](../src/data/static/nikke/103.json) | [`103.js`](../src/data/skills/103.js) |
| ❌ | Drake: Great Villain | [`104.json`](../src/data/static/nikke/104.json) | [`104.js`](../src/data/skills/104.js) |
| ❌ | Maxwell: Ordinary Mechanic | [`105.json`](../src/data/static/nikke/105.json) | [`105.js`](../src/data/skills/105.js) |
| ❌ | Sugar（SSR：Commemorative Keychain） | [`140.json`](../src/data/static/nikke/140.json) | [`140.js`](../src/data/skills/140.js) |
| ❌ | Mihara: Bonding Chain | [`162.json`](../src/data/static/nikke/162.json) | [`162.js`](../src/data/skills/162.js) |
| ✔️ | Privaty（SSR：Central Government Special Medal） | [`170.json`](../src/data/static/nikke/170.json) | [`170.js`](../src/data/skills/170.js) |
| ❌ | Maiden: Ice Rose | [`183.json`](../src/data/static/nikke/183.json) | [`183.js`](../src/data/skills/183.js) |
| ✔️ | Alice | [`191.json`](../src/data/static/nikke/191.json) | [`191.js`](../src/data/skills/191.js) |
| ❌ | Tove（SSR：Fire Starter） | [`192.json`](../src/data/static/nikke/192.json) | [`192.js`](../src/data/skills/192.js) |
| ❌ | Ludmilla: Winter Owner | [`194.json`](../src/data/static/nikke/194.json) | [`194.js`](../src/data/skills/194.js) |
| ✔️ | Snow White | [`220.json`](../src/data/static/nikke/220.json) | [`220.js`](../src/data/skills/220.js) |
| ❌ | Scarlet | [`222.json`](../src/data/static/nikke/222.json) | [`222.js`](../src/data/skills/222.js) |
| ✔️ | Nayuta | [`223.json`](../src/data/static/nikke/223.json) | [`223.js`](../src/data/skills/223.js) |
| ✔️ | Scarlet: Black Shadow | [`225.json`](../src/data/static/nikke/225.json) | [`225.js`](../src/data/skills/225.js) |
| ❌ | Dorothy: Serendipity | [`234.json`](../src/data/static/nikke/234.json) | [`234.js`](../src/data/skills/234.js) |
| ✔️ | Liberalio | [`262.json`](../src/data/static/nikke/262.json) | [`262.js`](../src/data/skills/262.js) |
| ✔️ | Blanc | [`270.json`](../src/data/static/nikke/270.json) | [`270.js`](../src/data/skills/270.js) |
| ✔️ | Noir | [`271.json`](../src/data/static/nikke/271.json) | [`271.js`](../src/data/skills/271.js) |
| ❌ | Rouge | [`272.json`](../src/data/static/nikke/272.json) | [`272.js`](../src/data/skills/272.js) |
| ❌ | Rosanna（SSR：Signet Ring） | [`280.json`](../src/data/static/nikke/280.json) | [`280.js`](../src/data/skills/280.js) |
| ✔️ | Moran | [`281.json`](../src/data/static/nikke/281.json) | [`281.js`](../src/data/skills/281.js) |
| ❌ | Privaty: Unkind Maid | [`313.json`](../src/data/static/nikke/313.json) | [`313.js`](../src/data/skills/313.js) |
| ❌ | Soda: Twinkling Bunny | [`314.json`](../src/data/static/nikke/314.json) | [`314.js`](../src/data/skills/314.js) |
| ❌ | Ade: Agent Bunny | [`315.json`](../src/data/static/nikke/315.json) | [`315.js`](../src/data/skills/315.js) |
| ✔️ | Velvet | [`316.json`](../src/data/static/nikke/316.json) | [`316.js`](../src/data/skills/316.js) |
| ❌ | Marciana: Marine Study | [`322.json`](../src/data/static/nikke/322.json) | [`322.js`](../src/data/skills/322.js) |
| ✔️ | Crown | [`330.json`](../src/data/static/nikke/330.json) | [`330.js`](../src/data/skills/330.js) |
| ✔️ | Helm | [`352.json`](../src/data/static/nikke/352.json) | [`352.js`](../src/data/skills/352.js) |
| ✔️ | Helm: Aquamarine | [`353.json`](../src/data/static/nikke/353.json) | [`353.js`](../src/data/skills/353.js) |
| ❌ | Mast: Romantic Maid | [`354.json`](../src/data/static/nikke/354.json) | [`354.js`](../src/data/skills/354.js) |
| ❌ | Anchor: Innocent Maid | [`355.json`](../src/data/static/nikke/355.json) | [`355.js`](../src/data/skills/355.js) |
| ✔️ | Zwei（SSR：Four-Leaf Clover Bookmark） | [`390.json`](../src/data/static/nikke/390.json) | [`390.js`](../src/data/skills/390.js) |
| ❌ | Guilty: Mighty Bunny | [`404.json`](../src/data/static/nikke/404.json) | [`404.js`](../src/data/skills/404.js) |
| ❌ | Sin: Swift Bunny | [`405.json`](../src/data/static/nikke/405.json) | [`405.js`](../src/data/skills/405.js) |
| ❌ | Flora（SSR：Planter We Made Together） | [`411.json`](../src/data/static/nikke/411.json) | [`411.js`](../src/data/skills/411.js) |
| ❌ | Volume | [`431.json`](../src/data/static/nikke/431.json) | [`431.js`](../src/data/skills/431.js) |
| ✔️ | Naga | [`450.json`](../src/data/static/nikke/450.json) | [`450.js`](../src/data/skills/450.js) |
| ✔️ | Red Hood | [`470.json`](../src/data/static/nikke/470.json) | [`470.js`](../src/data/skills/470.js) |
| ✔️ | Snow White: Heavy Arms | [`471.json`](../src/data/static/nikke/471.json) | [`471.js`](../src/data/skills/471.js) |
| ✔️ | Elegg: Boom and Shock | [`502.json`](../src/data/static/nikke/502.json) | [`502.js`](../src/data/skills/502.js) |
| ❌ | Cinderella | [`511.json`](../src/data/static/nikke/511.json) | [`511.js`](../src/data/skills/511.js) |
| ✔️ | Little Mermaid | [`513.json`](../src/data/static/nikke/513.json) | [`513.js`](../src/data/skills/513.js) |
| ❌ | Grave | [`514.json`](../src/data/static/nikke/514.json) | [`514.js`](../src/data/skills/514.js) |
| ❌ | Cinderella: Crystal Wave | [`515.json`](../src/data/static/nikke/515.json) | [`515.js`](../src/data/skills/515.js) |
| ❌ | Phantom（SSR：Precious Masks） | [`580.json`](../src/data/static/nikke/580.json) | [`580.js`](../src/data/skills/580.js) |
| ❌ | Arcana: Fortune Mate | [`583.json`](../src/data/static/nikke/583.json) | [`583.js`](../src/data/skills/583.js) |
| ✔️ | Mint | [`600.json`](../src/data/static/nikke/600.json) | [`600.js`](../src/data/skills/600.js) |
| ❌ | Prika | [`601.json`](../src/data/static/nikke/601.json) | [`601.js`](../src/data/skills/601.js) |
| ❌ | Mari | [`832.json`](../src/data/static/nikke/832.json) | [`832.js`](../src/data/skills/832.js) |
| ✔️ | Rei (Tentative Name) | [`834.json`](../src/data/static/nikke/834.json) | [`834.js`](../src/data/skills/834.js) |
| ✔️ | Asuka: WILLE | [`835.json`](../src/data/static/nikke/835.json) | [`835.js`](../src/data/skills/835.js) |
| ❌ | Ada | [`840.json`](../src/data/static/nikke/840.json) | [`840.js`](../src/data/skills/840.js) |
| ❌ | EVE | [`850.json`](../src/data/static/nikke/850.json) | [`850.js`](../src/data/skills/850.js) |
| ❌ | Raven | [`851.json`](../src/data/static/nikke/851.json) | [`851.js`](../src/data/skills/851.js) |
| ❌ | Queen (Makoto) | [`870.json`](../src/data/static/nikke/870.json) | [`870.js`](../src/data/skills/870.js) |
| ❌ | Yukiko | [`871.json`](../src/data/static/nikke/871.json) | [`871.js`](../src/data/skills/871.js) |
