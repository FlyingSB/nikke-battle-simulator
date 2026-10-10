# NIKKE 战斗模拟器术语表

> 英语—中文对照。左列为代码/游戏内英文原文，右列为本项目使用的中文译名。
> 如有歧义，以本文档为准。

---

## 目录

1. [基础属性](#1-基础属性)
2. [武器类型](#2-武器类型)
3. [代码系统](#3-代码系统)
4. [伤害公式](#4-伤害公式)
5. [战斗机制](#5-战斗机制)
6. [弹药与装填](#6-弹药与装填)
7. [爆裂系统](#7-爆裂系统)
8. [Buff / Debuff](#8-buff--debuff)
9. [技能触发事件](#9-技能触发事件)
10. [技能效果目标](#10-技能效果目标)
11. [技能效果类型](#11-技能效果类型)
12. [技能触发条件](#12-技能触发条件)
13. [装备系统](#13-装备系统)
14. [角色属性与成长](#14-角色属性与成长)
15. [职业与阵营](#15-职业与阵营)
16. [日志与结果](#16-日志与结果)

---

## 1. 基础属性

| 英文 | 中文 | 备注 |
|------|------|------|
| ATK / Attack | 攻击力 | |
| DEF / Defense | 防御力 | |
| HP | 体力 | |
| Max HP | 最大体力 | |
| ATK% | 攻击力百分比 | 装备词条 |
| Hit Rate | 命中率 | |
| Critical Rate | 暴击率 | 基础值 15% |
| Critical Damage | 暴击伤害 | 基础值 50% |
| Charge Speed | 蓄力速度 | |
| Charge Damage | 蓄力伤害 | |
| Reloading Speed | 换弹速度 | |
| Elemental Advantage Attack Damage | 优越代码攻击伤害 | |
| Max Ammunition Capacity | 最大装弹数 | |
| Rate of Fire (ROF) | 射速 | 单位 RPM（发/分钟） |

---

## 2. 武器类型

| 英文缩写 | 英文全称 | 中文 |
|----------|----------|------|
| AR | Assault Rifle | 突击步枪 |
| SMG | Submachine Gun | 冲锋枪 |
| SR | Sniper Rifle | 狙击步枪 |
| MG | Machine Gun | 机枪 |
| SG | Shotgun | 霰弹枪 |
| RL | Rocket Launcher | 发射器 |

---

## 3. 代码系统

| 英文 | 中文 |
|------|------|
| Code | 代码 |
| Fire | 燃烧 |
| Wind | 风压 |
| Iron | 铁甲 |
| Electric | 电击 |
| Water | 水冷 |

---

## 4. 伤害公式

| 英文 | 中文 | 备注 |
|------|------|------|
| Final Damage | 最终伤害 | |
| Base Damage | 基础伤害 | |
| Common Multiplier | 通用乘区 | |
| Elemental Advantage Multiplier | 优越代码乘区 | |
| Charge Damage Multiplier | 蓄力伤害乘区 | |
| Extra Multiplier | 额外乘区 | |
| Damage Taken Multiplier | 承伤乘区 | 用于 debuff |
| Effective ATK | 有效攻击力 | 含 ATK% 词条后的攻击力 |
| Effective DEF | 有效防御力 | |
| True Damage | 真实伤害 | 无视防御 |
| Pierce Damage | 穿透伤害 | |
| Skill Damage | 技能伤害 | |
| Normal Attack Damage | 普通攻击伤害 | |
| Sustained Damage | 持续伤害 | 以时间计的伤害 |
| Damage to Parts | 零件伤害 | |
| Damage to Interruption Parts | 阻止部位攻击伤害 | |
| Damage dealt to Shield | 对护盾造成的伤害 | |
| Distributed Damage | 分摊伤害 | |
| Sequential Attack Damage | 依次攻击伤害 | |
| Affects All Enemies Damage | 全体伤害 | |
| Affects 1 Enemy Damage | 单体伤害 | |
| Core Damage | 核心伤害 | 命中弱点 |
| Critical Damage | 暴击伤害 | |
| Effective Range | 合理射程 | |
| NEAR | 近距离 | |
| MID | 中距离 | |
| FAR | 远距离 | |
| Full Burst Bonus | 全爆裂加成 | |

---

## 5. 战斗机制

| 英文 | 中文 | 备注 |
|------|------|------|
| Tick | 时间单位 | 1 tick = 1/60 秒 |
| Tick Rate | 帧率 | 60 tick/秒 |
| Attack Loop | 攻击循环 | |
| Shot | 射击（普通攻击） | |
| Shot Count | 射击次数 | |
| Pullets | 弹丸 | |
| Foreswing | 前摇 | 攻击前硬直 |
| Backswing | 后摇 | 攻击后硬直 |
| Charge | 蓄力 | |
| Full Charge | 全蓄力 | |
| Charged Attack | 蓄力攻击 | |
| Charge Time | 蓄力时间 | |
| MG Ramp | 机枪射速加速 | 持续射击射速逐渐提升 |
| Core Hit | 核心命中 | 命中核心弱点 |
| Core Hit Rate | 核心命中率 | |
| Life Steal | 生命偷取 | |
| Combat Assist | 战斗协助 | |
| Stun | 眩晕 | 角色自身眩晕 |
| Weapon Switch | 换武器 | 特定技能触发 |
| Unlimited Ammunition | 无限装弹 | |
| Pierce | 穿透 | 子弹穿透敌人 |
| HoT | 持续治疗 | Heal over Time |
| DoT | 持续伤害 | Damage over Time |
| Shield | 护盾 | |
| Cover | 掩体 | |
| Cover Heal | 掩体回复 | |
| Enemy Phase | 敌人阶段 | 敌人体力阶段切换 |
| Monte Carlo | 蒙特卡洛模拟 | 随机采样多次取均值 |
| DPS | 每秒伤害 | Damage Per Second |

---

## 6. 弹药与装填

| 英文 | 中文 | 备注 |
|------|------|------|
| Ammo | 弹药 | |
| Ammo Left | 剩余弹药 | |
| Max Ammunition Capacity | 最大装弹数 | |
| Bonus Ammo | 额外弹药（词条） | 装备词条 |
| Ammo Expanded | 弹药扩充 | 技能临时扩充 |
| Reload | 装填 | |
| Reload End | 装填完成 | |
| Reload Speed | 换弹速度 | |
| Reload Fraction | 装填分率 | 剩余弹药/满弹，用于计算装填时长 |
| Ammo Milestone | 弹药里程碑 | 400/500 发触发点 |
| Last Bullet | 最后的子弹 | |

---

## 7. 爆裂系统

| 英文 | 中文 | 备注 |
|------|------|------|
| Burst Gauge | 爆裂槽 | 共享 |
| Burst Gauge Max | 爆裂槽上限 | |
| Burst Energy | 爆裂能量 | 每次射击产生 |
| Burst Energy Per Shot | 每次射击爆裂能量 | |
| Burst Phase | 爆裂阶段 | |
| Burst Skill | 爆裂技能 | |
| Burst I / II / III | 爆裂 Ⅰ / Ⅱ / Ⅲ | 三个施放阶段 |
| Full Burst | 全爆裂 | 三阶段均完成后激活 |
| Full Burst Active | 全爆裂激活中 | |
| Full Burst End | 全爆裂结束 | |
| Burst Caster | 爆裂施放者 | |
| Burst CD / Burst Cooldown | 爆裂冷却 | |
| Reduce Burst CD | 缩减爆裂冷却 | |
| Grant Burst Gauge | 增加爆裂槽 | |

---

## 8. Buff / Debuff

| 英文 | 中文 | 备注 |
|------|------|------|
| Buff | 增益效果 | |
| Debuff | 减益效果 | |
| Buff Global | 全局增益 | 持续全场 |
| Stack | 层数 | |
| Stack Limit | 层数上限 | |
| End Tick | 结束时间 | buff 到期 tick |
| Rounds Left | 剩余轮数 | 以攻击轮次计的 buff 时长 |
| ATK Buff | 攻击力增益 | |
| DEF Down | 防御力降低 | 对敌 debuff |
| Attack Damage ▲ | 攻击伤害提升 | |
| Normal Attack Damage ▲ | 普通攻击伤害提升 | |
| Charge Damage ▲ | 蓄力伤害提升 | |
| Charge Speed ▲ | 蓄力速度提升 | |
| Critical Rate ▲ | 暴击率提升 | |
| Critical Damage ▲ | 暴击伤害提升 | |
| Hit Rate ▲ | 命中率提升 | |
| Elemental Advantage Attack Damage ▲ | 优越代码攻击伤害提升 | |
| Reloading Speed ▲ | 换弹速度提升 | |
| Max Ammunition Capacity ▲ | 最大装弹数提升 | |
| ATK Speed ▲ | 攻击速度提升 | |
| Damage Taken ▲ | 所受伤害提升 | 施加给敌人的 debuff |
| Pierce Damage ▲ | 穿透伤害提升 | |
| Core Damage ▲ | 核心伤害提升 | |
| Sustained Damage ▲ | 持续伤害提升 | |
| True Damage ▲ | 真实伤害提升 | |
| Distributed Damage ▲ | 分摊伤害提升 | |
| Life Steal ▲ | 生命偷取提升 | |
| Projectile Explosion Damage ▲ | 发射体爆炸伤害提升 | |
| Max HP ▲ | 最大体力提升 | |

---

## 9. 技能触发事件

| 英文（触发器名） | 中文 | 说明 |
|------------------|------|------|
| PROGRAM_INIT | 程序初始化 | 模拟开始前 |
| BATTLE_START | 战斗开始 | |
| ENTER_BURST_I | 进入爆裂阶段 Ⅰ | |
| ENTER_BURST_II | 进入爆裂阶段 Ⅱ | |
| ENTER_BURST_III | 进入爆裂阶段 Ⅲ | |
| BURST_SKILL_USE | 使用爆裂技能 | |
| ENTER_FULL_BURST | 进入全爆裂 | |
| FULL_BURST_END | 全爆裂结束 | |
| SHOT_COUNT | 射击次数达到 | |
| SQUAD_SHOT_COUNT | 队伍射击次数达到 | |
| LAST_BULLET | 最后一颗子弹 | |
| FULL_CHARGE | 全蓄力 | |
| AMMO_MILESTONE | 弹药里程碑 | |
| INTERVAL | 定时（全程） | |
| INTERVAL_IN_BURST | 定时（爆裂期间） | |
| HEAL_RECEIVED | 受到治疗时 | |
| APPLYING_SHIELD | 护盾生效时 | |
| COVER_HEAL | 掩体回复时 | |
| CORE_HIT | 核心命中时 | |
| RELOAD_END | 装弹完成时 | |

### 游戏描述原文 → 触发器对照

建模时，将技能描述中的触发条件文本对应到以下触发器：

| 游戏描述原文（英文） | 触发器 |
|---------------------|--------|
| Activates at the beginning of battle. | `BATTLE_START` |
| Activates when entering Burst Stage 1. | `ENTER_BURST_I` |
| Activates when entering Burst Stage 2. | `ENTER_BURST_II` |
| Activates when entering Burst Stage 3. | `ENTER_BURST_III` |
| Activates at the beginning of Full Burst. / Activates when entering Full Burst. | `ENTER_FULL_BURST` |
| Activates at the end of Full Burst. | `FULL_BURST_END` |
| Activates when using Burst Skill. | `BURST_SKILL_USE` |
| Activates when attacking with Full Charge. | `FULL_CHARGE` |
| Activates when landing X normal attack(s). | `SHOT_COUNT`（opts.every = X） |
| Activates when any ally fires X shot(s). | `SQUAD_SHOT_COUNT`（opts.every = X） |
| Activates after the last round is fired. | `LAST_BULLET` |
| Activates after reloading. | `RELOAD_END` |
| Activates when hitting the Core. | `CORE_HIT` |
| Activates every X sec(s) during Full Burst. | `INTERVAL_IN_BURST`（opts.every = X） |
| Activates every X sec(s). | `INTERVAL`（opts.every = X） |
| Activates when an ally receives healing. | `HEAL_RECEIVED` |

---

## 10. 技能效果目标

| 英文 | 中文 |
|------|------|
| SELF | 自身 |
| ALL_ALLIES | 全体队友 |
| ENEMY | 敌人 |
| BURST_CASTERS | 爆裂施放者 |
| NON_BURST_CASTERS | 非爆裂施放者 |
| BURST_III_UNITS | 爆裂 Ⅲ 角色 |
| ALLIES_WITH_ELEMENT | 同属性队友 |
| LOWEST_ATK_BURST_III | 攻击力最低的爆裂 Ⅲ 角色 |
| ALL_ALLIES_EXCEPT_SELF | 除自身外全体队友 |
| N_ALLIES_EXCEPT_SELF | N 名队友（除自身） |
| N_ALLIES_SELF_LAST | N 名队友（自身最后） |

---

## 11. 技能效果类型

| 英文 | 中文 |
|------|------|
| BUFF | 施加增益 |
| BUFF_GLOBAL | 施加全局增益 |
| SKILL_DAMAGE | 技能伤害 |
| HEAL | 治疗 |
| RELOAD_AMMO | 补充弹药 |
| REDUCE_BURST_CD | 缩减爆裂冷却 |
| GRANT_BURST_GAUGE | 增加爆裂槽 |
| AMMO_EXPAND | 扩充弹药 |
| STUN_SELF | 自身眩晕 |
| WEAPON_SWITCH | 切换武器 |

---

## 12. 技能触发条件

| 英文 | 中文 |
|------|------|
| NOT_COMBAT_ASSIST | 非战斗协助状态 |
| SQUAD_HAS_BUFF | 队伍拥有指定 buff |
| SELF_BUFF_STACKS_GTE | 自身 buff 层数 ≥ N |
| ENEMY_BUFF_STACKS_GTE | 敌方 buff 层数 ≥ N |
| IN_FULL_BURST | 全爆裂期间 |
| IS_CHARGED | 蓄力攻击 |
| IS_CORE_HIT | 核心命中 |
| HEALED_UNIT_IS_SELF | 被治疗者为自身 |

---

## 13. 装备系统

| 英文 | 中文 | 备注 |
|------|------|------|
| Equipment | 装备 | |
| T10 | T10 装备 | 最高级装备 |
| Equipment Slot | 装备槽 | |
| Equipment Slot Head / Torso / Arm / Leg | 装备槽 头部 / 胸部 / 手部 / 腿部 | 四个装备槽 |
| Equipment Option | 装备词条 | |
| Harmony Cube | 和谐魔方 | |
| Favorite Item / Fav | 珍藏品 | |
| SSR Favorite Skills | SSR 珍藏品技能 | |
| Adjutant Cube | 副官魔方 | 含 Charge Speed 被动 |
| Anti Code HC | 反代码魔方 | 含优越代码攻击伤害加成 |
| Resilience Quick Reload HC | 韧性快速装填魔方 | 含换弹速度 |
| Bastion Cube Reload Up HC | 堡垒换弹提速魔方 | 含触发换弹机制 |

---

## 14. 角色属性与成长

| 英文 | 中文 | 备注 |
|------|------|------|
| Grade | 极限突破等级 | 0–3 |
| Core | 核心加强等级 | 0–7，需 Grade 3 |
| Bond Level | 好感度等级 | |
| Bond Bonus | 好感度加成 | |
| Limit Break | 突破上限 | |
| Research Bonus | 研究加成 | |
| Global Research | 通用研究 | |
| Skill Level | 技能等级 | |
| Skill 1 / S1 | 技能 1 | |
| Skill 2 / S2 | 技能 2 | |
| Burst Skill | 爆裂技能 | |

---

## 15. 职业与阵营

| 英文 | 中文 |
|------|------|
| Attacker | 火力型 |
| Defender | 防御型 |
| Supporter | 辅助型 |
| ELYSION | 极乐净土 |
| MISSILIS | 米西利斯 |
| TETRA | 泰特拉 |
| PILGRIM | 朝圣者 |
| ABNORMAL | 反常 |

---

## 16. 日志与结果

| 英文 | 中文 | 备注 |
|------|------|------|
| Battle Result | 战斗结果 | |
| Hit Log | 命中日志 | |
| Buff Log | Buff 日志 | |
| Ammo Log | 弹药日志 | |
| Burst Energy Log | 爆裂能量日志 | |
| Total Damage | 总伤害 | |
| DPS | 每秒伤害 | |
| Burst Count | 爆裂次数 | |
| Crit Rate (actual) | 实际暴击率 | |
| Hit Count | 命中次数 | |
| Reload Count | 装填次数 | |
| Skill Damage | 技能伤害总量 | |
