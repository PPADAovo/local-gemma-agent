// 파일 찾기(대충 말해도 찾기): "아까 만든 자기소개 웹사이트", "발표 ppt", "원주율 엑셀"처럼
// 제목을 정확히 몰라도 단어 일부·비슷한 글자·파일 종류·최근 수정 시간으로 점수를 매겨 찾습니다.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const KIND = [
  [/(ppt|피피티|파워포인트|발표|슬라이드|한쇼)/i, ['.pptx', '.ppt', '.show']],
  [/(엑셀|excel|(?<![가-힣])표(?![가-힣])|한셀|스프레드시트|시트)/i, ['.xlsx', '.xls', '.cell', '.csv']],
  [/(한글|hwp|한컴)/i, ['.hwp', '.hwpx']],
  [/(워드|word|docx)/i, ['.docx', '.doc']],
  [/(pdf|피디에프)/i, ['.pdf']],
  [/(사진|이미지|그림|캡처|스크린샷|png|jpg)/i, ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp']],
  [/(웹사이트|웹페이지|사이트|홈페이지|html|대시보드|캔버스)/i, ['.html', '.htm']],
  [/(메모|텍스트|txt|노트)/i, ['.txt', '.md']],
  [/(코드|스크립트|파이썬|자바스크립트)/i, ['.js', '.mjs', '.py', '.ts', '.ps1', '.cs']],
  [/(동영상|영상|비디오|mp4)/i, ['.mp4', '.mov', '.avi', '.mkv']],
  [/(음악|노래|mp3|음성|녹음)/i, ['.mp3', '.wav', '.m4a', '.flac']],
];
const STOP = new Set(['파일', '찾아', '찾아줘', '찾아봐', '열어', '열어줘', '열어봐', '보여줘', '줘', '좀', '그', '그거', '이거', '저거', '아까', '방금', '만든', '내가', '거', '것', '어디', '있는', '있던', '폴더', '에서', '안에', 'the', 'file']);
const JOSA = /(으로|에서|에게|하고|이랑|랑|이나|이라는|라는|을|를|이|가|은|는|에|의|도|로|와|과|파일)$/;
// tests는 빼지 않습니다(사용자 프로젝트의 tests 안에 찾는 폴더·파일이 있을 수 있음).
const SKIP = /^(node_modules|\.git|\.cache|AppData|\$Recycle\.Bin|복구기록|대화기록|작업로그|__pycache__|\.vscode|\.idea|dist|build|venv|\.venv)$/i;
const norm = s => String(s).toLowerCase().normalize('NFC').replace(/[\s_\-.()[\]{}·,]+/g, '');
const bigrams = s => { const a = []; for (let i = 0; i < s.length - 1; i++) a.push(s.slice(i, i + 2)); return a; };
// 같은 뜻의 다른 말: "치이카와 달력"이라고 해도 "치이카와-캘린더" 폴더를 찾도록 합니다.
const SAME = [['캘린더', '달력', 'calendar'], ['사진', '이미지', 'photo', 'image'], ['메모', '노트'], ['발표', '프레젠테이션', 'presentation'], ['영상', '동영상', 'video'], ['음악', '노래', 'music'], ['일정', 'schedule'], ['설정', 'settings', 'config'], ['게임', 'game'], ['프로젝트', 'project']];
const variants = t => { const group = SAME.find(g => g.some(w => t.includes(w))); if (!group) return [t]; const w = group.find(x => t.includes(x)); return [t, ...group.filter(x => x !== w).map(x => t.replace(w, x))]; };
let exactQuery = false; // 확장자까지 적은 정확한 이름이면 비슷한 말로 넓히지 않습니다.
const contains = (name, t) => exactQuery ? name.includes(t) : variants(t).some(v => name.includes(v));
function similar(token, name) { // 토큰 글자쌍이 이름에 얼마나 들어 있는지 (오타·띄어쓰기 차이 허용)
  if (token.length < 2) return 0;
  const g = bigrams(token); if (!g.length) return 0;
  return g.filter(x => name.includes(x)).length / g.length;
}
export function parseQuery(q) {
  const text = String(q || '');
  const exts = new Set(); for (const [re, list] of KIND) if (re.test(text)) list.forEach(e => exts.add(e));
  const direct = text.match(/\.[a-z0-9]{2,5}\b/gi); if (direct) direct.forEach(e => exts.add(e.toLowerCase()));
  // 종류 단어(ppt, 엑셀…)만 있는 토큰은 빼고, '매출대시보드'처럼 다른 글자가 섞이면 그대로 이름 검색에 씁니다.
  const kindOnly = t => KIND.every(([re]) => true) && t.replace(new RegExp(KIND.map(([re]) => re.source.slice(1, -1)).join('|'), 'gi'), '') === '';
  const tokens = text.split(/[\s,./\\'"“”‘’!?~]+/).map(t => t.replace(JOSA, '')).map(norm).filter(t => t && !STOP.has(t) && !kindOnly(t));
  return {tokens, exts: [...exts]};
}
export function defaultRoots(workspace) {
  const home = os.homedir();
  return [workspace, path.join(home, 'Desktop'), path.join(home, 'OneDrive', '바탕 화면'), path.join(home, 'OneDrive', 'Desktop'), path.join(home, 'Documents'), path.join(home, 'OneDrive', '문서'), path.join(home, 'Downloads'), path.join(home, 'Pictures'), path.join(home, 'Videos'), path.join(home, 'Music')].filter(Boolean);
}
// folders: true면 이름이 맞는 폴더도 결과에 넣습니다(find_file용). 파일 열기 등에서는 파일만 찾습니다.
export async function findFiles(query, roots, {limit = 8, maxDepth = 5, maxEntries = 30000, timeoutMs = 5000, folders = false, agentMade = null} = {}) {
  const {tokens, exts} = parseQuery(query);
  if (!tokens.length && !exts.length) return [];
  // "치이카와달력.html"처럼 이름 전체를 말했으면 그 이름의 파일이 무조건 맨 위
  const named = String(query).trim().split(/[\\/]/).pop().match(/^[^\s]+\.[a-z0-9]{1,6}$/i)?.[0]?.toLowerCase().normalize('NFC') || '';
  exactQuery = !!named;
  // "메모.txt"의 "메모"처럼 이름이 종류 단어와 같아도, 이름을 말했으면 이름으로 찾습니다(아무 txt나 내놓지 않게).
  if (named && !tokens.length) tokens.push(norm(named.replace(/\.[^.]+$/, '')));
  const started = Date.now(), seen = new Set(), results = []; let count = 0;
  async function walk(dir, depth) {
    if (depth > maxDepth || count > maxEntries || Date.now() - started > timeoutMs) return;
    let entries; try { entries = await fs.readdir(dir, {withFileTypes: true}); } catch { return; }
    for (const e of entries) {
      if (++count > maxEntries) return;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP.test(e.name) || e.name.startsWith('.')) continue;
        if (folders && tokens.length) {
          // 폴더 이름에 찾는 단어가 들어 있으면 폴더도 후보로 (짧은 단어 하나로는 너무 많이 걸려서 3글자 이상만)
          const name = norm(e.name); let score = 0, hit = 0;
          for (const t of tokens) if (t.length >= 2 && contains(name, t)) { score += 3 + (name === t ? 2 : name.startsWith(t) ? 1 : 0); hit++; }
          // 폴더는 짧은 단어 하나만 맞으면 너무 많이 걸려서, 단어가 둘 이상 맞거나 3글자 이상 단어가 맞을 때만 넣습니다.
          if (hit && (hit >= 2 || tokens.some(t => t.length >= 3 && contains(name, t)))) results.push({full, ext: '', score, hit, dir: true});
        }
        await walk(full, depth + 1); continue;
      }
      if (!e.isFile()) continue;
      const key = full.toLowerCase(); if (seen.has(key)) continue; seen.add(key);
      const ext = path.extname(e.name).toLowerCase(), base = norm(path.basename(e.name, ext)), folder = norm(path.basename(dir));
      let score = 0, hit = 0;
      for (const t of tokens) {
        if (contains(base, t)) { score += 3 + (base.startsWith(t) ? 1 : 0); hit++; }
        else if (contains(folder, t)) { score += 1.2; hit++; }
        else { const s = similar(t, base); if (s >= 0.5) { score += 2.5 * s; hit++; } }
      }
      if (exts.length) { if (exts.includes(ext)) score += tokens.length ? 2 : 3; else if (!tokens.length) continue; else score -= 1; }
      if (named && e.name.toLowerCase().normalize('NFC') === named) { score += 10; hit = Math.max(hit, tokens.length); }
      if (tokens.length && hit === 0) continue;
      if (score <= 0) continue;
      results.push({full, ext, score, hit});
    }
  }
  for (const r of roots) { if (await fs.stat(r).catch(() => null)) await walk(r, 0); }
  // 같은 경로가 여러 뿌리(작업공간·바탕화면)에서 겹쳐 잡히면 하나만 남깁니다.
  const unique = [...new Map(results.map(r => [r.full.toLowerCase(), r])).values()];
  const made = agentMade instanceof Set ? agentMade : new Set();
  await Promise.all(unique.map(async r => {
    const st = await fs.stat(r.full).catch(() => null); r.mtime = st?.mtimeMs || 0; r.size = st?.size || 0;
    const days = (Date.now() - r.mtime) / 864e5; r.score += days < 1 ? 1.5 : days < 7 ? 0.8 : days < 30 ? 0.3 : 0;
    r.of = tokens.length;
    // 말한 단어가 모두 들어 있는 이름을, 일부만 맞는 이름보다 확실히 위로
    if (tokens.length > 1) r.score += r.hit >= tokens.length ? 2.5 : -1.5;
    // 에이전트가 예전에 만든 결과물은 사용자가 말하는 "내 파일"이 아닐 때가 많아 조금 아래로
    if (made.has(r.full.toLowerCase())) { r.agentMade = true; r.score -= 2; }
    // 코드·앱이 든 폴더(프로젝트)는 같은 이름의 압축 파일이나 그 안의 낱개 파일보다 위로
    if (r.dir) { r.inside = await peek(r.full); if (r.inside?.names.some(n => /\.(exe|ps1|cs|js|mjs|ts|py|java|html?|sln|csproj)$|^(package|manifest)\.json$/i.test(n))) r.score += 1.5; }
  }));
  unique.sort((a, b) => b.score - a.score || b.mtime - a.mtime);
  return unique.slice(0, limit);
}
// 폴더 안을 살짝 봐서(파일 수, 대표 파일 이름) 무엇이 든 폴더인지 결과에 보여 줍니다.
async function peek(dir) {
  try {
    const entries = await fs.readdir(dir, {withFileTypes: true});
    const files = entries.filter(e => e.isFile()).map(e => e.name), dirs = entries.filter(e => e.isDirectory()).length;
    const key = /\.(exe|html?|js|mjs|ts|tsx|py|ps1|cs|java|json|md|txt|sln|csproj)$/i;
    const shown = [...files.filter(f => /^(readme|index|main|app|package\.json|manifest\.json)/i.test(f)), ...files.filter(f => key.test(f))];
    return {files: files.length, dirs, names: [...new Set(shown)].slice(0, 6)};
  } catch { return null; }
}
// 이번 컴퓨터에서 에이전트가 새로 만든 파일 목록(실행 취소 기록의 created)을 읽습니다.
export async function agentCreatedFiles(undoDir) {
  const out = new Set();
  try {
    for (const d of await fs.readdir(undoDir)) {
      try { const data = JSON.parse(await fs.readFile(path.join(undoDir, d, '기록.json'), 'utf8')); for (const f of data.files || []) if (f.status === 'created' && f.path) out.add(path.resolve(f.path).toLowerCase()); } catch {}
    }
  } catch {}
  return out;
}
export function describe(list) {
  const when = r => new Date(r.mtime).toLocaleString('ko-KR', {timeZone: 'Asia/Seoul'});
  const size = r => r.size < 1024 ? r.size + 'B' : r.size < 1048576 ? Math.round(r.size / 1024) + 'KB' : (r.size / 1048576).toFixed(1) + 'MB';
  const match = r => r.of > 1 ? (r.hit >= r.of ? ', 말한 단어 모두 일치' : ', 말한 단어 ' + r.hit + '/' + r.of + '개만 일치') : '';
  const inside = r => r.inside ? ' · 안에 파일 ' + r.inside.files + '개' + (r.inside.dirs ? '·폴더 ' + r.inside.dirs + '개' : '') + (r.inside.names.length ? ' (' + r.inside.names.join(', ') + ')' : '') : '';
  return list.map((r, i) => (i + 1) + '. ' + (r.dir ? '[폴더] ' + r.full + '  (' + when(r) + match(r) + ')' + inside(r) : r.full + '  (' + when(r) + ', ' + size(r) + match(r) + ')') + (r.agentMade ? ' [에이전트가 예전에 만든 파일]' : '')).join('\n');
}
// 확실한 1등인지: 2등보다 점수가 충분히 높으면 바로 열어도 됨
export function confident(list) { return list.length === 1 || (list.length > 1 && list[0].score >= list[1].score + 2); }
