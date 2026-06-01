/**
 * 下载所有角色的小尺寸图片（sm, 即 si_c***_**_s.webp）并缓存到项目中。
 *
 * 输出目录：src/data/static/images/sm/
 * 文件命名：{resourceId}_{skinIndex}.webp（例如 016_00.webp）
 *
 * 用法：
 *   node scripts/download-character-images.mjs
 *   node scripts/download-character-images.mjs --delay 300   # 自定义请求间隔（毫秒）
 *
 * 已存在的文件直接跳过（支持断点续传）。
 * 遇到 404 记录到 MISSING 列表，最后统一报告。
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { getSmCharacterUrl } from '../src/data/blablalink-url.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT      = join(__dirname, '..');
const OUT_DIR   = join(ROOT, 'src', 'data', 'static', 'images', 'sm');

// ── CLI 参数 ──────────────────────────────────────────────────────────────────
const args  = process.argv.slice(2);
const delay = (() => {
  const i = args.indexOf('--delay');
  return i !== -1 ? Number(args[i + 1]) : 250;
})();

// ── 工具 ──────────────────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function pad(n, len) {
  return String(n).padStart(len, '0');
}

function filename(resourceId, skinIndex) {
  return `${pad(resourceId, 3)}_${pad(skinIndex, 2)}.webp`;
}

// ── 主流程 ───────────────────────────────────────────────────────────────────
async function main() {
  // 1. 读取角色花名册
  const charPath = join(ROOT, 'src', 'data', 'static', 'characters.json');
  const raw  = JSON.parse(readFileSync(charPath, 'utf8'));
  const chars = Array.isArray(raw) ? raw : (raw.records ?? raw);

  // 2. 展开所有 (resourceId, skinIndex) 组合
  const tasks = [];
  for (const c of chars) {
    const rid = c.resource_id;
    // 基础皮肤
    tasks.push({ rid, skin: 0 });
    // 所有服装皮肤
    for (const cos of (c.costumes ?? [])) {
      tasks.push({ rid, skin: cos.costume_index });
    }
  }

  mkdirSync(OUT_DIR, { recursive: true });

  const missing  = [];  // 404 列表
  let downloaded = 0;
  let skipped    = 0;

  console.log(`共 ${tasks.length} 张图片（${chars.length} 角色 + 服装）`);
  console.log(`输出目录：${OUT_DIR}`);
  console.log(`请求间隔：${delay} ms\n`);

  for (let i = 0; i < tasks.length; i++) {
    const { rid, skin } = tasks[i];
    const fname  = filename(rid, skin);
    const fpath  = join(OUT_DIR, fname);

    // 已存在则跳过
    if (existsSync(fpath)) {
      skipped++;
      continue;
    }

    const url = getSmCharacterUrl(rid, skin);
    process.stdout.write(`[${i + 1}/${tasks.length}] ${fname} ... `);

    try {
      const res = await fetch(url);
      if (res.status === 404) {
        console.log('404');
        missing.push({ rid, skin, url });
        await sleep(delay);
        continue;
      }
      if (!res.ok) {
        // 非 404 错误：等待更长时间后重试一次
        console.log(`HTTP ${res.status} — 稍后重试`);
        await sleep(delay * 4);
        const res2 = await fetch(url);
        if (!res2.ok) {
          console.log(`  重试失败 HTTP ${res2.status}，跳过`);
          missing.push({ rid, skin, url, status: res2.status });
          continue;
        }
        const buf2 = Buffer.from(await res2.arrayBuffer());
        writeFileSync(fpath, buf2);
        downloaded++;
        console.log(`OK（重试后）`);
        await sleep(delay);
        continue;
      }

      const buf = Buffer.from(await res.arrayBuffer());
      writeFileSync(fpath, buf);
      downloaded++;
      console.log('OK');
    } catch (err) {
      console.log(`ERROR: ${err.message}`);
      missing.push({ rid, skin, url, error: err.message });
    }

    await sleep(delay);
  }

  // ── 汇总报告 ──────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════');
  console.log(`完成：下载 ${downloaded}，跳过（已存在）${skipped}，失败 ${missing.length}`);

  if (missing.length > 0) {
    console.log('\n⚠️  以下图片不可用（404 或其他错误）：');
    for (const m of missing) {
      const tag = m.error ? `ERROR(${m.error})` : `HTTP ${m.status ?? 404}`;
      console.log(`  resource_id=${m.rid}  skin=${m.skin}  ${tag}`);
      console.log(`    ${m.url}`);
    }

    // 写到文件方便日后处理
    const reportPath = join(ROOT, 'scripts', 'missing-character-images.json');
    writeFileSync(reportPath, JSON.stringify(missing, null, 2));
    console.log(`\n完整列表已写入 ${reportPath}`);
  }
}

main().catch(err => {
  console.error('脚本异常退出：', err);
  process.exit(1);
});
