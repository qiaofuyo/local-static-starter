// server.mjs
/**
 * 测试
 * node server.mjs --port 3000 --web-dir "D:\03_Tools\白板\dist\apps\web"
 */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, exec } from 'node:child_process';
import { promisify } from 'node:util';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execAsync = promisify(exec);

// ---------- CONFIG (from argv or defaults) ----------
const params = {
  host: '127.0.0.1',
  port: 3000,
  webDir: path.resolve(__dirname, 'dist'),
  shutdownDelayMs: 500,
  debugMode: false
};
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i += 2) {
  const key = args[i].replace(/^--/, '');
  const value = args[i + 1];
  if (key === 'port') params.port = parseInt(value, 10);
  if (key === 'web-dir') params.webDir = value.replace(/^"(.*)"$/, '$1');
  if (key === 'shutdown-delay-ms') params.shutdownDelayMs = parseInt(value, 10);
  if (key === 'debug-mode') params.debugMode = true;
}
const MAX_PORT = params.port + 10;  // 最多重试 10 次

// ---------- MIME table ----------
const MIME = {
  // HTML 文件
  '.htm': 'text/html; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  
  // XHTML 文件
  '.xhtml': 'application/xhtml+xml; charset=utf-8',
  
  // CSS 文件
  '.css': 'text/css; charset=utf-8',
  
  // JavaScript 文件
  '.js': 'application/javascript; charset=utf-8',  // 推荐使用 application/javascript
  '.mjs': 'application/javascript; charset=utf-8', // ES6+ 模块化的 JS 文件
  
  // 普通文本文件
  '.txt': 'text/plain; charset=utf-8',
  
  // JSON 数据
  '.json': 'application/json; charset=utf-8',
  
  // Linked Data JSON 文件
  '.jsonld': 'application/ld+json; charset=utf-8',
  
  // 视频文件类型
  '.mp4': 'video/mp4',  // MP4 格式视频
  '.flv': 'video/x-flv',  // FLV 格式视频
  '.ts': 'video/mp2t',  // MPEG2 视频流，通常用于流媒体
  '.avi': 'video/x-msvideo',  // AVI 格式视频
  
  // 音频文件类型
  '.weba': 'audio/webm',  // WebM 格式音频
  '.webm': 'video/webm',  // WebM 格式视频，也可用于音频流
  '.mp3': 'audio/mpeg',  // MP3 音频格式
  '.aac': 'audio/aac',  // AAC 音频格式
  '.ogg': 'audio/ogg',  // OGG 音频格式
  '.flac': 'audio/flac',  // FLAC 音频格式
  '.midi': 'audio/midi',  // MIDI 音频格式

  // 图片文件类型
  '.webp': 'image/webp',  // WebP 图片格式
  '.png': 'image/png',  // PNG 格式图片
  '.jpg': 'image/jpeg',  // JPEG 格式图片
  '.jpeg': 'image/jpeg',  // JPEG 格式图片
  '.svg': 'image/svg+xml',  // SVG 矢量图格式
  '.ico': 'image/vnd.microsoft.icon',  // Windows 图标文件

  // 字体文件类型
  '.woff': 'font/woff',  // Web Open Font Format
  '.woff2': 'font/woff2',  // Web Open Font Format 2
  '.ttf': 'font/ttf',  // TrueType 字体格式
  '.eot': 'application/vnd.ms-fontobject',  // Embedded OpenType 字体
  '.otf': 'font/otf',  // OpenType 字体格式
  
  // 常见文档类型
  '.pdf': 'application/pdf',  // PDF 格式文件
  '.csv': 'text/csv; charset=utf-8',  // CSV 文件
  '.xml': 'application/xml; charset=utf-8',  // XML 文件
  '.rtf': 'application/rtf',  // 富文本格式文件
  
  // 常见压缩格式
  '.zip': 'application/zip',  // ZIP 文件格式
  '.rar': 'application/x-rar-compressed',  // RAR 压缩文件格式
  
  // 二进制文件
  '.bin': 'application/octet-stream',  // 二进制流文件
  '.map': 'application/json',  // JavaScript Source Map 文件，通常为 JSON 格式
  
  // WebAssembly 文件
  '.wasm': 'application/wasm',  // WebAssembly 文件类型
};

// ---------- SSE client tracking ----------
const sseClients = new Set();

function serveNotFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('404 Not Found');
}

async function serveFile(res, filePath, headers = {}) {
  try {
    const buf = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type, ...headers });
    res.end(buf);
  } catch (e) {
    serveNotFound(res);
  }
}

function injectSseScript(htmlContent) {
  const injection = `
<!-- injected by local dev server: keep-alive SSE -->
<script>
(function(){
  try {
    const es = new EventSource('/_sse');
    window.__drawnix_sse = es;
    window.addEventListener('beforeunload', ()=> { try { es.close(); } catch(e){} });
  } catch(e) {
    console.warn('SSE injection failed', e);
  }
})();
</script>
<!-- end injected -->
`;
  const idx = htmlContent.lastIndexOf('</body>');
  if (idx !== -1) {
    return htmlContent.slice(0, idx) + injection + htmlContent.slice(idx);
  }
  return htmlContent + injection;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${params.host}:${params.port}`);
    const pathname = decodeURIComponent(url.pathname);

    if (pathname === '/_sse') {
      res.writeHead(200, {
        Connection: 'keep-alive',
        'Cache-Control': 'no-cache',
        'Content-Type': 'text/event-stream; charset=utf-8',
      });
      res.write('\n');
      sseClients.add(res);
      res.write(': connected\n\n');
      console.log(`[SSE] client connected (${sseClients.size})`);

      req.on('close', () => {
        sseClients.delete(res);
        console.log(`[SSE] client disconnected (${sseClients.size})`);
        checkShutdownCondition();
      });
      return;
    }

    let filePath = path.join(params.webDir, pathname);
    const stat = await fs.stat(filePath).catch(() => null);

    if (stat && stat.isDirectory()) {
      const indexFile = path.join(filePath, 'index.html');
      const ok = await fs.stat(indexFile).catch(() => null);
      if (ok) filePath = indexFile;
      else return serveNotFound(res);
    } else if (!stat) {
      const possible = path.join(params.webDir, 'index.html');
      const exists = await fs.stat(possible).catch(() => null);
      if (exists) {
        filePath = possible;
      } else {
        return serveNotFound(res);
      }
    }

    if (filePath.endsWith('index.html')) {
      const buf = await fs.readFile(filePath, 'utf8');
      const injected = injectSseScript(buf);
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      res.end(injected, 'utf8');
      return;
    }

    await serveFile(res, filePath);
  } catch (err) {
    console.error('Server error:', err);
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('500 Internal Server Error');
  }
});

function checkShutdownCondition() {
  if (sseClients.size === 0) {
    console.log('No clients connected. Shutting down server in', params.shutdownDelayMs, 'ms ...');
    setTimeout(() => {
      server.close(() => {
        console.log('Server closed. Exiting process.');
        process.exit(0);
      });
      setTimeout(() => process.exit(0), 3000).unref();
    }, Math.max(0, params.shutdownDelayMs));
  }
}

// 端口被占用时显示弹窗
function showPortOccupiedPopup(port, processInfo) {
  const title = '端口被占用';
  const procText = processInfo
    ? `"${processInfo.name}" (PID: ${processInfo.pid})`
    : '未知进程';

  const cmdText = process.platform === 'win32'
    ? `taskkill /f /pid ${processInfo?.pid}`
    : `kill -9 ${processInfo?.pid}`;

  const message = processInfo
    ? `端口 ${port} 已被程序占用！\n${procText}\n\n释放命令：\n${cmdText}\n\n或在任务管理器中结束该进程。`
    : `端口 ${port} 已被占用，但未能检测到占用程序。`;

  if (process.platform === 'win32') {
    spawn('msg', ['*', message], { windowsHide: true });
  } else if (process.platform === 'darwin') {
    const script = `
      display dialog "${message.replace(/"/g, '\\"')}" \
      with title "${title}" \
      buttons {"知道了"} default button "知道了" \
      with icon stop
    `;
    spawn('osascript', [' -e', script], { stdio: 'ignore', detached: true }).unref();
  } else {
    try {
      spawn('notify-send', [
        `-a`, 'Dev Server',
        `-i`, 'dialog-warning',
        title,
        message.replace(/\n/g, ' \\n ')
      ], { stdio: 'ignore', detached: true }).unref();
    } catch {
      console.log('Linux 弹窗需安装: sudo apt install libnotify-bin');
    }
  }
}

// 查找占用端口的进程名
async function getProcessNameByPid(pid) {
  if (!pid) return null;

  if (process.platform === 'win32') {
    try {
      const { stdout } = await execAsync(`tasklist /fi "pid eq ${pid}" /fo csv`);
      const lines = stdout.trim().split('\n');
      if (lines.length < 2) return null;
      const row = lines[1];
      const match = row.match(/"([^"]+)"/); // 提取第一个引号内的程序名
      return match ? match[1] : null;
    } catch {
      return null;
    }
  } else {
    // macOS / Linux
    try {
      const { stdout } = await execAsync(`ps -p ${pid} -o comm=`);
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }
}

// 查找占用端口的 PID 和进程名
async function findProcessByPort(port) {
  if (process.platform === 'win32') {
    try {
      const { stdout } = await execAsync(`netstat -ano | findstr :${port}`);
      const lines = stdout.trim().split('\n').filter(line => line.includes(`:${port}`));
      if (lines.length === 0) return null;

      // 取第一条（通常是监听的）
      const match = lines[0].trim().match(/\d+$/);
      const pid = match ? parseInt(match[0], 10) : null;
      if (!pid) return null;

      const name = await getProcessNameByPid(pid);
      return { pid, name: name || '未知程序' };
    } catch {
      return null;
    }
  } else {
    // macOS / Linux
    try {
      const { stdout } = await execAsync(`lsof -i:${port} -t -F pn`);
      const lines = stdout.trim().split('\n');
      let pid = null, name = null;
      for (const line of lines) {
        if (line.startsWith('p')) pid = parseInt(line.slice(1), 10);
        if (line.startsWith('n')) name = line.slice(1).split('/').pop();
      }
      if (pid) {
        const comm = await getProcessNameByPid(pid);
        return { pid, name: comm || name || '未知程序' };
      }
      return null;
    } catch {
      return null;
    }
  }
}

const onListening = () => {
  console.log(`Serving ${params.webDir}`);
  console.log(`HTTP server listening at http://${params.host}:${params.port}`);
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', `http://${params.host}:${params.port}`], { windowsHide: true, detached: true });
    } else if (process.platform === 'darwin') {
      spawn('open', [`http://${params.host}:${params.port}`], { detached: true });
    } else {
      spawn('xdg-open', [`http://${params.host}:${params.port}`], { detached: true });
    }
  } catch (e) {
    console.log('Could not auto-open browser:', e);
  }
}

function tryStart() {
  if (params.port > MAX_PORT) {
    console.error('已尝试太多端口，启动失败');
    process.exit(1);
  }

  console.log(`\n尝试启动服务器于 http://${params.host}:${params.port} ...\n`);

  server.listen({
    port: params.port,
    host: params.host,
    reuseAddr: true   // 关键！允许重用 TIME_WAIT 端口，否则关闭一个 HTTP 服务器时，操作系统不会立刻释放端口，而是让它进入 TIME_WAIT 状态，持续 1~4 分钟（取决于系统）。
  });
  // 监听事件（只绑定一次避免因为递归导致监听多个事件）
  server.once('listening', onListening);

  server.once('error', async (err) => {
    server.removeListener('listening', onListening); // 清理监听事件
    if (err.code === 'EADDRINUSE') {
      console.log(`端口 ${params.port} 已被占用，查找占用进程...`);

      const processInfo = await findProcessByPort(params.port);
      if (processInfo) {
        console.log(`端口 ${params.port} 被程序 "${processInfo.name}" (PID: ${processInfo.pid}) 占用`);
        if (process.platform === 'win32') {
          console.log(`\n释放方法：`);
          console.log(`   taskkill /f /pid ${processInfo.pid}`);
          console.log(`\n或打开任务管理器（Ctrl+Shift+Esc）→ 详细信息 → 结束 PID ${processInfo.pid} 的任务`);
        } else {
          console.log(`\n释放命令：kill -9 ${processInfo.pid}`);
        }
        showPortOccupiedPopup(params.port, processInfo);
      } else {
        console.log(`未能检测到占用端口 ${params.port} 的进程（可能权限不足或瞬时占用）`);
        showPortOccupiedPopup(params.port, null);
      }

      // 递归尝试下一个端口
      params.port += 1;
      tryStart();
    } else {
      console.error('服务器启动失败:', err);
      process.exit(1);
    }
  });
}

/* 启动 */
tryStart();

process.on('SIGINT', () => {
  console.log('SIGINT received. Exiting.');
  server.close(() => process.exit(0));
});
