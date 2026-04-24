# NIKKE 战斗模拟器 — 开发者说明

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

四个回归测试脚本覆盖了除技能以外的所有稳定游戏数据：

```bash
# 统一入口（推荐）：依次运行全部四个套件
node scripts/tests/test-all.mjs
```

各套件说明：

| 脚本 | 内容 | 前置条件 |
|------|------|----------|
| `test-formulas.mjs` | 伤害公式纯数学回归（无网络、无 I/O） | 无 |
| `test-urls.mjs` | URL 生成算法回归 | 无 |
| `test-data.mjs` | 数据管线（Bond / 装备 / 方块 / 属性管线） | 需先运行 `scripts/tests/test-battle.mjs` 填充 `scripts/cache/` |
| `test-stats.mjs` | 完整属性管线集成测试 | 缓存为空时自动从 CDN 拉取 |

单独运行：

```bash
node scripts/tests/test-formulas.mjs
node scripts/tests/test-urls.mjs
node scripts/tests/test-data.mjs   # 首次请先运行 test-battle.mjs
node scripts/tests/test-stats.mjs
```

提交引擎或数据相关的改动之前，全部四个套件必须通过（exit 0）。

## 数据更新
游戏更新时，CDN URL 的哈希值会发生变化。请更新 `src/data/manifest.js`。
查找新 URL 的方法：在浏览器中打开 blablalink.com/shiftyspad，查看 Network 标签页中
对 sg-tools-cdn.blablalink.com 的请求。

## 不使用 npm / 不使用 TypeScript
保持纯 JS。主应用不需要 package.json。
