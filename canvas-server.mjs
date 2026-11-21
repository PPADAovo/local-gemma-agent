// 캔버스 서버: 작업공간/캔버스 폴더의 HTML(대시보드·차트)을 같은 와이파이의 휴대폰에서 볼 수 있게 보여줍니다.
// 읽기 전용이며 캔버스 폴더 밖의 파일은 절대 내보내지 않습니다.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const dir = fileURLToPath(new URL('./작업공간/캔버스/', import.meta.url));
const PORT = Number(process.env.CANVAS_PORT || 8787);
const types = {'.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml'};

http.createServer(async (req, res) => {
  try {
    if (req.method !== 'GET') { res.writeHead(405); return res.end(); }
    let name = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '');
    if (!name) {
      const files = (await fs.readdir(dir).catch(() => [])).filter(f => f.endsWith('.html'));
      res.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
      return res.end('<meta name="viewport" content="width=device-width"><h2>로컬 Gemma 캔버스</h2><ul>' + files.map(f => `<li><a href="/${encodeURIComponent(f)}">${f.replace(/</g, '&lt;')}</a></li>`).join('') + '</ul>');
    }
    const full = path.resolve(dir, name);
    if (!full.startsWith(path.resolve(dir) + path.sep)) { res.writeHead(403); return res.end(); }
    const data = await fs.readFile(full);
    res.writeHead(200, {'content-type': types[path.extname(full).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store'});
    res.end(data);
  } catch { res.writeHead(404); res.end('없음'); }
}).listen(PORT, '0.0.0.0');
