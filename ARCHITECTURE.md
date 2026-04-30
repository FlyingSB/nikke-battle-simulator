# NIKKE 战斗模拟器 — 架构

## 目标
为《胜利女神：NIKKE》提供一个完全前端、零后端的战斗模拟器。
可在任何浏览器中运行。数据从游戏 CDN 拉取并在本地缓存。

---

## 技术栈
- **原生 ES modules** — 无构建步骤，直接通过 HTTP 服务器运行
- **Vanilla JS** — 无框架开销
- **HTML/CSS** — UI
- **localStorage** — CDN 数据缓存及版本跟踪

---

## 数据源

所有游戏数据从 `sg-tools-cdn.blablalink.com` 加载。URL 基于哈希，在游戏更新时会变化。清单文件
（`src/data/manifest.js`）列出了所有已知 URL，游戏打补丁时必须更新。

### 已知数据文件

| 文件 | 内容 | 关键字段 |
|------|---------|------------|
| `c4619ec8...` | 角色花名册 | id, class, element, weapon, faction, costumes |
| `78500850...` | 角色详情 | 各等级（1-500）属性、skill1、skill2、burst |
| `e8b9e7f7...` | 等级进阶表 | 每级所需经验 / 金币（1-556） |
| `02d7f979...` | 装备（模组） | A/B/C/D 槽位、属性、稀有度 T1-T10 |
| `bdeb2eac...` | 和谐魔方 | 各强化等级属性、2 个技能 |
| `cb6bd83f...` | Attractive（突破） | HP/ATK/DEF 比率加成（tier 1-40） |
| `258f8531...` | 回收室 | 研究升级（ATK/DEF/HP 固定值加成） |
| `b46c877b...` | Buff 效果 | ATK/CRIT/DEF/AMMO buff 的 effect ID |
| `7548a00f...` | 服装 | 每个角色的 costume_index |
| `452950b7...` | 角色资源 | 角色名 → resource_id 映射 |

### 自动更新策略
`blablalink.com/shiftyspad` 的 JS bundle 使用带版本号的资源加载器，由 IndexedDB
（`__ss_indexdb_cache_version_configs__`）支撑。在发现正式的版本 manifest 接口之前，
更新通过以下方式跟踪：

1. `scripts/check-update.js` — 一个 Node 脚本，抓取工具页面、解析 JS bundle URL，
   并提取其中变更的 CDN 路径。
2. `manifest.js` 是唯一事实来源（single source of truth）— 发现新哈希时更新此文件。

---

## 项目结构

```
nikke-battle-simulator/
├── index.html
├── src/
│   ├── main.js                  # 应用入口
│   ├── data/
│   │   ├── manifest.js          # CDN URL 注册表（打补丁时更新）
│   │   ├── loader.js            # 拉取 + localStorage 缓存
│   │   ├── models.js            # 将原始 JSON 规范化为带类型的对象
│   │   └── skill-traits.js      # 技能属性声明式注册表
│   ├── engine/
│   │   ├── constants.js         # 游戏常量
│   │   ├── damage.js            # 伤害公式
│   │   ├── stats.js             # 计算最终属性（基础 + 等级 + 装备 + 魔方 + 研究）
│   │   ├── skill-executor.js    # 技能触发分派器
│   │   ├── battle-utils.js      # 战斗辅助函数（fireSkillHit、getBuffSums 等）
│   │   └── battle.js            # 主模拟循环
│   └── ui/
│       ├── squad-builder.js     # 角色 / 装备选择
│       └── results.js           # 汇总 + 图表
├── scripts/
│   └── tests/                   # 回归测试套件
├── ARCHITECTURE.md
└── CLAUDE.md
```

---

## 战斗引擎

### 属性计算管线
```
BaseStats(character, level)
  + EquipmentStats(module_A + B + C + D)
  + HarmonyCubeStats(cube, enhancement_level)
  + AttractiveBonus(ascension_tier)        ← 在基础属性上的百分比倍率
  + RecycleRoomBonus(research_unlocked)    ← 固定加成
  + SkillPassiveBuffs(skill1, skill2)
= FinalStats { atk, hp, def, crit_rate, crit_dmg, max_ammo, ... }
```

### 伤害公式（社区已验证）
```
Raw = ATK × WeaponMultiplier
Skill = Raw × SkillMultiplier
Element = Skill × (1 + ElementBonus)      ← 属性克制时 +10%
Crit = Element × (1 + CritDmg) × CritRate + Element × (1 - CritRate)
Final = Crit × (1 - DEF / (DEF + Constant)) × MiscModifiers
```

**属性克制表：**
- 火 > 风
- 水 > 火
- 电 > 水
- 风 > 铁
- 铁 > 电

**防御常量：** 待数据挖掘确认（根据社区研究可能约为 32000）

### 战斗循环
```
1. 初始化队伍（玩家 5 位 NIKKE vs 敌人）
2. 每个 tick（基于帧，模拟 60 fps）：
   a. 每位 NIKKE 开火（自动攻击 + 换弹周期）
   b. 爆裂槽通过命中积累
   c. 生效中的 buff 倒计时递减
   d. 检查技能触发（skill1 @ 条件，skill2 @ 条件）
3. 爆裂轮转：爆裂槽满即进入 Burst Step 1
4. 跟踪：总伤害、爆裂次数
5. 结束条件：达到时间上限
```

### 技能系统
技能逻辑通过 `src/data/skill-traits.js` 声明式注册，由 `src/engine/skill-executor.js` 统一分派。主要触发时机：
- `BATTLE_START` / `ENTER_FULL_BURST` / `FULL_BURST_END`
- `BURST_SKILL_USE`（各阶段释放爆裂技能时）
- `SHOT_COUNT` / `LAST_BULLET` / `FULL_CHARGE` / `CORE_HIT`
- `INTERVAL_IN_BURST` / `HEAL_RECEIVED` / `AMMO_MILESTONE`

---

## UI 流程

```
[Squad Builder]
  → 选择 5 位 NIKKE
  → 为每位配置：等级、核心、装备槽、和谐魔方
  → 设置技能等级（1 / 2 / burst）

[Enemy Config]
  → HP、DEF、属性、类型（rapture / boss）

[Simulate]
  → 跑 N 次迭代（暴击 RNG 的蒙特卡洛）
  → 显示：平均 DPS、爆裂时机、技能触发率

[Results]
  → 每位 NIKKE 的伤害分解
  → 时间线图表
  → TTK（击杀用时）分布
```

---

## 缓存策略

```js
// 加载时：
1. 检查 localStorage 里的缓存数据与版本哈希
2. 命中 → 使用缓存，后台检查更新
3. 未命中 → 拉取所有 CDN 文件并按哈希存储

// 缓存键：
"nikke_data_v{hash}_characters"
"nikke_data_v{hash}_equipment"
// 等等
```

---

## 已知缺口（待研究）
- [ ] 防御减伤公式中常量的精确值
- [ ] 完整的技能效果解析（技能位于角色详情 JSON 中）
- [ ] Boss 专属机制（伤害上限、阶段切换）
- [ ] 掩体 / 护盾 HP 机制
