/**
 * trace-server.mjs — 本地开发调试用 trace 收集服务器
 *
 * 启动后监听 http://localhost:7474，UI 模拟完成后自动 POST
 * battle trace，服务器将其写入 scripts/traces/{date}-{time}/battle-log.json。
 *
 * 用法：
 *   node scripts/trace-server.mjs
 *
 * 停止：Ctrl+C
 */

import { createServer }     from 'http';
import { mkdir, writeFile } from 'fs/promises';
import { join, dirname }    from 'path';
import { fileURLToPath }    from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TRACES_DIR = join(__dirname, 'traces');
const PORT = 7474;

function pad2(n) { return String(n).padStart(2, '0'); }

function traceDir() {
  const now = new Date();
  const date = `${now.getFullYear()}${pad2(now.getMonth() + 1)}${pad2(now.getDate())}`;
  const time = `${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
  return join(TRACES_DIR, `${date}-${time}`);
}

const server = createServer(async (req, res) => {
  // CORS — 允许来自任意 localhost 端口的请求
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== 'POST' || req.url !== '/trace') {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', async () => {
    try {
      const dir = traceDir();
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'battle-log.json'), body, 'utf8');
      console.log(`[trace] 已写入 ${dir}`);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      console.error('[trace] 写入失败:', err.message);
      res.writeHead(500);
      res.end(err.message);
    }
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[trace-server] 监听 http://127.0.0.1:${PORT}`);
  console.log('[trace-server] UI 模拟时将自动写入 scripts/traces/{date}-{time}/battle-log.json');
});
