# NIKKE 战斗模拟器 — 开发者说明

## 1.1 ⚠️ 语言要求

- **所有文档、注释、PR 描述、回复均使用中文**
- 代码变量名、函数名使用英文（遵循语言惯例）
- 复杂业务逻辑的注释必须用中文注明意图

## 开发服务器
本项目使用原生 ES modules — 无需构建步骤。
本地运行时，请通过 HTTP 提供项目根目录（不要用 file://）：

```bash
# 方式 1：VS Code Live Server 扩展（推荐）
# 右键点击 index.html → Open with Live Server

# 方式 2：Python
python -m http.server 5173

# 方式 3：Node（安装后可用）
npx serve .
```

## 项目结构
```
src/data/      – CDN 数据获取与缓存
src/engine/    – 战斗模拟逻辑
src/ui/        – UI 组件
scripts/       – 工具脚本（Node.js，手动运行）
```

## 测试套件

七个回归测试脚本，统一入口依次全部运行：

```bash
node scripts/tests/test-all.mjs
```

各套件说明：

| 脚本 | 内容 | 前置条件 |
|------|------|----------|
| `test-formulas.mjs` | 伤害公式纯数学回归（无网络、无 I/O） | 无 |
| `test-skills.mjs` | 技能属性注册表回归 | 无 |
| `test-rapi-burst.mjs` | Rapi 爆裂步骤与 Combat Assist 逻辑 | 无 |
| `test-cinderella.mjs` | Cinderella 技能修正回归 | 无 |
| `test-urls.mjs` | URL 生成算法回归 | 无 |
| `test-data.mjs` | 数据管线（Bond / 装备 / 方块 / 属性管线） | 需先运行 `scripts/tests/test-battle.mjs` 填充 `scripts/cache/` |
| `test-stats.mjs` | 完整属性管线集成测试 | 缓存为空时自动从 CDN 拉取 |

提交引擎或数据相关的改动之前，全部七个套件必须通过（exit 0）。

## 数据更新
游戏更新时，CDN URL 的哈希值会发生变化。请更新 `src/data/manifest.js`。
查找新 URL 的方法：在浏览器中打开 blablalink.com/shiftyspad，查看 Network 标签页中
对 sg-tools-cdn.blablalink.com 的请求。

## 不使用 npm / 不使用 TypeScript
保持纯 JS。主应用不需要 package.json。
