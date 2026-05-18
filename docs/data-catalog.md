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

存储路径：[`src/data/static/cubes/`](../src/data/static/cubes/)（文件名为 `resource_id.json`）  
加载器优先读取本地文件，缺失时回退 CDN。名称与 ID 映射见 [`src/data/manifest.js`](../src/data/manifest.js) → `CUBE_NAMES`。

| 文件 | 魔方名称 |
|------|---------|
| [`10001.json`](../src/data/static/cubes/10001.json) | Assault Cube |
| [`10002.json`](../src/data/static/cubes/10002.json) | Onslaught Cube |
| [`10003.json`](../src/data/static/cubes/10003.json) | Resilience Cube |
| [`10004.json`](../src/data/static/cubes/10004.json) | Bastion Cube |
| [`10005.json`](../src/data/static/cubes/10005.json) | Adjutant Cube |
| [`10006.json`](../src/data/static/cubes/10006.json) | Wingman Cube |
| [`10007.json`](../src/data/static/cubes/10007.json) | Destruction Cube |
| [`10008.json`](../src/data/static/cubes/10008.json) | Piercing Cube |
| [`10009.json`](../src/data/static/cubes/10009.json) | Assist Cube |
| [`10010.json`](../src/data/static/cubes/10010.json) | Rupture Cube |
| [`11001.json`](../src/data/static/cubes/11001.json) | Quantum Cube |
| [`12001.json`](../src/data/static/cubes/12001.json) | Endurance Cube |
| [`12002.json`](../src/data/static/cubes/12002.json) | Tempering Cube |
| [`13001.json`](../src/data/static/cubes/13001.json) | Vigor Cube |
| [`13002.json`](../src/data/static/cubes/13002.json) | Healing Cube |

### 收藏品数据

存储路径：[`src/data/static/favorites/`](../src/data/static/favorites/)  
加载器优先读取本地文件，缺失时回退 CDN（CDN URL 见 `manifest.js` → `FAVORITE_ITEM_URLS`）。  
SSR 专属收藏品（ID 以 `2` 开头）仅有本地文件，无 CDN URL 记录。

ID 规则：`100XYY`，X = 武器类型（1=AR / 2=MG / 3=RL / 4=SG / 5=SMG / 6=SR），YY = `01`（R）/ `02`（SR）。  
SSR 专属收藏品与角色绑定，提升全部三个技能等级。

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
| [`201101.json`](../src/data/static/favorites/201101.json) | Fire Starter（Tove SSR） | SSR |
| [`201401.json`](../src/data/static/favorites/201401.json) | Central Government Special Medal（Privaty SSR） | SSR |

---

## 角色表

数据文件存储路径：[`src/data/static/nikke/`](../src/data/static/nikke/)（角色 CDN roledata，文件名为 `resource_id.json`）  
技能文件存储路径：[`src/data/skills/`](../src/data/skills/)（导出默认对象，包含 `skill1` / `skill2` / `burstSkill` 三个技能处理器）

| 角色 | 数据（文件） | 技能（文件） |
|------|------------|------------|
| Anis: Sparkling Summer | [`15.json`](../src/data/static/nikke/15.json) | [`15.js`](../src/data/skills/15.js) |
| Rapi: Red Hood | [`16.json`](../src/data/static/nikke/16.json) | [`16.js`](../src/data/skills/16.js) |
| Anis: Star | [`17.json`](../src/data/static/nikke/17.json) | [`17.js`](../src/data/skills/17.js) |
| Neon: Vision Eye | [`18.json`](../src/data/static/nikke/18.json) | [`18.js`](../src/data/skills/18.js) |
| Miranda | [`32.json`](../src/data/static/nikke/32.json) | [`32.js`](../src/data/skills/32.js) |
| Liter | [`82.json`](../src/data/static/nikke/82.json) | [`82.js`](../src/data/skills/82.js) |
| Drake | [`101.json`](../src/data/static/nikke/101.json) | [`101.js`](../src/data/skills/101.js) |
| Maxwell | [`102.json`](../src/data/static/nikke/102.json) | [`102.js`](../src/data/skills/102.js) |
| Mihara: Bonding Chain | [`162.json`](../src/data/static/nikke/162.json) | [`162.js`](../src/data/skills/162.js) |
| Privaty（SSR：Central Government Special Medal） | [`170.json`](../src/data/static/nikke/170.json) | [`170.js`](../src/data/skills/170.js) |
| Maiden: Ice Rose | [`183.json`](../src/data/static/nikke/183.json) | [`183.js`](../src/data/skills/183.js) |
| Alice | [`191.json`](../src/data/static/nikke/191.json) | [`191.js`](../src/data/skills/191.js) |
| Tove（SSR：Fire Starter） | [`192.json`](../src/data/static/nikke/192.json) | [`192.js`](../src/data/skills/192.js) |
| Snow White | [`220.json`](../src/data/static/nikke/220.json) | [`220.js`](../src/data/skills/220.js) |
| Nayuta | [`223.json`](../src/data/static/nikke/223.json) | [`223.js`](../src/data/skills/223.js) |
| Scarlet | [`222.json`](../src/data/static/nikke/222.json) | [`222.js`](../src/data/skills/222.js) |
| Scarlet: Black Shadow | [`225.json`](../src/data/static/nikke/225.json) | [`225.js`](../src/data/skills/225.js) |
| Dorothy: Serendipity | [`234.json`](../src/data/static/nikke/234.json) | [`234.js`](../src/data/skills/234.js) |
| Liberalio | [`262.json`](../src/data/static/nikke/262.json) | [`262.js`](../src/data/skills/262.js) |
| Blanc | [`270.json`](../src/data/static/nikke/270.json) | [`270.js`](../src/data/skills/270.js) |
| Noir | [`271.json`](../src/data/static/nikke/271.json) | [`271.js`](../src/data/skills/271.js) |
| Rouge | [`272.json`](../src/data/static/nikke/272.json) | [`272.js`](../src/data/skills/272.js) |
| Moran | [`281.json`](../src/data/static/nikke/281.json) | [`281.js`](../src/data/skills/281.js) |
| Crown | [`330.json`](../src/data/static/nikke/330.json) | [`330.js`](../src/data/skills/330.js) |
| Helm | [`352.json`](../src/data/static/nikke/352.json) | [`352.js`](../src/data/skills/352.js) |
| Mast: Romantic Maid | [`354.json`](../src/data/static/nikke/354.json) | [`354.js`](../src/data/skills/354.js) |
| Anchor: Innocent Maid | [`355.json`](../src/data/static/nikke/355.json) | [`355.js`](../src/data/skills/355.js) |
| Red Hood | [`470.json`](../src/data/static/nikke/470.json) | [`470.js`](../src/data/skills/470.js) |
| Snow White: Heavy Arms | [`471.json`](../src/data/static/nikke/471.json) | [`471.js`](../src/data/skills/471.js) |
| Cinderella | [`511.json`](../src/data/static/nikke/511.json) | [`511.js`](../src/data/skills/511.js) |
| Little Mermaid | [`513.json`](../src/data/static/nikke/513.json) | [`513.js`](../src/data/skills/513.js) |
| Asuka: WILLE | [`835.json`](../src/data/static/nikke/835.json) | [`835.js`](../src/data/skills/835.js) |
| Ade: Agent Bunny | [`315.json`](../src/data/static/nikke/315.json) | [`315.js`](../src/data/skills/315.js) |
| Naga | [`450.json`](../src/data/static/nikke/450.json) | [`450.js`](../src/data/skills/450.js) |
| Raven | [`851.json`](../src/data/static/nikke/851.json) | [`851.js`](../src/data/skills/851.js) |
| Diesel: Winter Sweets | [`75.json`](../src/data/static/nikke/75.json) | [`75.js`](../src/data/skills/75.js) |
| Grave | [`514.json`](../src/data/static/nikke/514.json) | [`514.js`](../src/data/skills/514.js) |
| Brid: Silent Track | [`73.json`](../src/data/static/nikke/73.json) | [`73.js`](../src/data/skills/73.js) |
| Volume | [`431.json`](../src/data/static/nikke/431.json) | [`431.js`](../src/data/skills/431.js) |
| D: Killer Wife | [`43.json`](../src/data/static/nikke/43.json) | [`43.js`](../src/data/skills/43.js) |
