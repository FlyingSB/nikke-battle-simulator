# 数据资源目录

收录所有从 CDN 下载并存储在项目中的静态数据，以及已完成建模的角色技能。

---

## CDN 静态数据

CDN 来源：`sg-tools-cdn.blablalink.com`（通过 blablalink.com/shiftyspad 发现）。  
URL 哈希随游戏补丁变化，版本号记录在 [`src/data/manifest.js`](../src/data/manifest.js)（当前版本：`20260424`）。

### 共享游戏数据

存储路径：[`src/data/static/`](../src/data/static/)

| 文件 | 内容说明 |
|------|---------|
| [`characters.json`](../src/data/static/characters.json) | 角色花名册（英文名，189 个角色） |
| [`levels.json`](../src/data/static/levels.json) | 进阶 / 升级表 |
| [`attractive.json`](../src/data/static/attractive.json) | 吸引力系统数据 |
| [`recycleRoom.json`](../src/data/static/recycleRoom.json) | 回收室数据 |
| [`charLevels.json`](../src/data/static/charLevels.json) | 角色经验 / 等级进阶表（CharacterLevel + SynchroLevel，556 条记录） |
| [`equipment.json`](../src/data/static/equipment.json) | 装备数据 |
| [`harmonyCubes.json`](../src/data/static/harmonyCubes.json) | 魔方数据 |
| [`equipmentEffects.json`](../src/data/static/equipmentEffects.json) | 装备词条效果（每个词条的 state_effect_id_list） |
| [`buffEffects.json`](../src/data/static/buffEffects.json) | Buff 系统数据 |

### 魔方详情数据

运行时按 `resource_id` 动态获取，缓存于 `localStorage`。  
名称与 ID 映射见 [`src/data/manifest.js`](../src/data/manifest.js) → `CUBE_NAMES`。

| resource_id | 魔方名称 |
|-------------|---------|
| 10001 | Assault Cube |
| 10002 | Onslaught Cube |
| 10003 | Resilience Cube |
| 10004 | Bastion Cube |
| 10005 | Adjutant Cube |
| 10006 | Wingman Cube |
| 10007 | Destruction Cube |
| 10008 | Piercing Cube |
| 10009 | Assist Cube |
| 10010 | Rupture Cube |
| 11001 | Quantum Cube |
| 12001 | Endurance Cube |
| 12002 | Tempering Cube |
| 13001 | Vigor Cube |
| 13002 | Healing Cube |

### 收藏品数据

存储路径：[`src/data/static/favorites/`](../src/data/static/favorites/)

ID 规则：`100XYY`，X = 武器类型（1=AR / 2=MG / 3=RL / 4=SG / 5=SMG / 6=SR），YY = `01`（R）/ `02`（SR）。  
SSR 专属收藏品 ID 以 `2` 开头，与角色绑定，提升全部三个技能等级。

| 文件 | 收藏品名称 | 类型 |
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
| [`200601.json`](../src/data/static/favorites/200601.json) | Miranda 专属收藏品 | SSR |
| [`200701.json`](../src/data/static/favorites/200701.json) | Antique Compass（Helm SSR） | SSR |
| [`200801.json`](../src/data/static/favorites/200801.json) | Villain Figurine（Drake SSR） | SSR |
| [`201701.json`](../src/data/static/favorites/201701.json) | Moran 专属收藏品 | SSR |

---

## 已建模角色技能

存储路径：[`src/data/skills/`](../src/data/skills/)  
文件名为角色 `resource_id`，导出默认对象，包含 `skill1` / `skill2` / `burstSkill` 三个技能处理器。

| 文件 | 角色 |
|------|------|
| [`15.js`](../src/data/skills/15.js) | Anis: Sparkling Summer |
| [`16.js`](../src/data/skills/16.js) | Rapi: Red Hood |
| [`32.js`](../src/data/skills/32.js) | Miranda |
| [`82.js`](../src/data/skills/82.js) | Liter |
| [`101.js`](../src/data/skills/101.js) | Drake |
| [`183.js`](../src/data/skills/183.js) | Maiden: Ice Rose |
| [`191.js`](../src/data/skills/191.js) | Alice |
| [`223.js`](../src/data/skills/223.js) | Nayuta |
| [`225.js`](../src/data/skills/225.js) | Scarlet: Black Shadow |
| [`262.js`](../src/data/skills/262.js) | Liberalio |
| [`281.js`](../src/data/skills/281.js) | Moran |
| [`330.js`](../src/data/skills/330.js) | Crown |
| [`352.js`](../src/data/skills/352.js) | Helm |
| [`354.js`](../src/data/skills/354.js) | Mast: Romantic Maid |
| [`355.js`](../src/data/skills/355.js) | Anchor: Innocent Maid |
| [`470.js`](../src/data/skills/470.js) | Red Hood |
| [`511.js`](../src/data/skills/511.js) | Cinderella |
| [`513.js`](../src/data/skills/513.js) | Little Mermaid |
