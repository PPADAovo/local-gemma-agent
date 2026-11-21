// 변경 추적: 파일을 바꾸기 전에 백업하고, 바뀐 줄 수(+/-)와 변경 내용(diff)을 기록합니다.
// 채팅의 "파일 N개를 편집했습니다" 카드와 [실행 취소]·[변경 사항 보기] 버튼이 이 기록을 씁니다.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';

const TEXT = /\.(txt|md|js|mjs|cjs|ts|tsx|jsx|py|ps1|psm1|cmd|bat|cs|json|csv|html?|css|xml|ya?ml|ini|log|java|c|cpp|h|hpp|sql|sh|rs|go|kt|swift|php|rb|lua|toml|env|gitignore)$/i;
let runId,dir,manifestPath;
const originals = new Map(); // 경로 → {existed, text, backup}
const entries = new Map();
export function reset(){runId=new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8);dir=fileURLToPath(new URL('./복구기록/실행취소/'+runId+'/',import.meta.url));manifestPath=path.join(dir,'기록.json');originals.clear();entries.clear();}
reset();
export const manifest=()=>entries.size?manifestPath:null;
async function hashFile(file){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');}

const readText = async f => { try { const b = await fs.readFile(f); if (b.includes(0)) return null; return b.toString('utf8'); } catch { return null; } };

// 바꾸기 전에 한 번만 호출(같은 파일을 여러 번 고쳐도 처음 상태를 기준으로 비교)
export async function before(full) {
  const key = path.resolve(full).toLowerCase();
  if (originals.has(key)) return;
  const st = await fs.stat(full).catch(() => null);
  let backup = null, text = null;
  if (st?.isFile()) {
    await fs.mkdir(dir, {recursive: true});
    backup = path.join(dir, originals.size + '-' + path.basename(full));
    await fs.copyFile(full, backup);
    if (TEXT.test(full) && st.size < 2_000_000) text = await readText(full);
  }
  originals.set(key, {existed: !!st?.isFile(), text, backup, full: path.resolve(full)});
}

function lineDiff(a, b) {
  const A = a === null ? [] : a.replace(/\r\n/g, '\n').split('\n'), B = b === null ? [] : b.replace(/\r\n/g, '\n').split('\n');
  if (a !== null && a.endsWith('\n')) A.pop(); if (b !== null && b.endsWith('\n')) B.pop();
  let s = 0; while (s < A.length && s < B.length && A[s] === B[s]) s++;
  let e = 0; while (e < A.length - s && e < B.length - s && A[A.length - 1 - e] === B[B.length - 1 - e]) e++;
  const a2 = A.slice(s, A.length - e), b2 = B.slice(s, B.length - e);
  let ops = [];
  if (a2.length * b2.length <= 4_000_000) {
    const n = a2.length, m = b2.length, L = Array.from({length: n + 1}, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a2[i] === b2[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    let i = 0, j = 0;
    while (i < n && j < m) { if (a2[i] === b2[j]) { ops.push([' ', a2[i]]); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) ops.push(['-', a2[i++]]); else ops.push(['+', b2[j++]]); }
    while (i < n) ops.push(['-', a2[i++]]); while (j < m) ops.push(['+', b2[j++]]);
  } else ops = [...a2.map(x => ['-', x]), ...b2.map(x => ['+', x])];
  const added = ops.filter(o => o[0] === '+').length, removed = ops.filter(o => o[0] === '-').length;
  // 앞뒤 3줄만 남긴 보기용 diff (최대 400줄)
  const full = [...A.slice(Math.max(0, s - 3), s).map(x => [' ', x]), ...ops, ...A.slice(A.length - e, Math.min(A.length, A.length - e + 3)).map(x => [' ', x])];
  const keep = full.map((o, k) => o[0] !== ' ' || full.slice(Math.max(0, k - 3), k + 4).some(p => p[0] !== ' '));
  const out = []; let gap = false;
  full.forEach((o, k) => { if (keep[k]) { out.push(o[0] + ' ' + o[1]); gap = false; } else if (!gap) { out.push('@ …'); gap = true; } });
  return {added, removed, diff: out.slice(0, 400).join('\n') + (out.length > 400 ? '\n@ … (' + (out.length - 400) + '줄 더)' : '')};
}

// 바꾼 뒤 호출 → 채팅 카드용 표시 문자열을 돌려줌
export async function after(full) {
  const key = path.resolve(full).toLowerCase(), o = originals.get(key) || {existed: false, text: null, backup: null, full: path.resolve(full)};
  const st = await fs.stat(full).catch(() => null);
  const status = !st ? 'deleted' : o.existed ? 'modified' : 'created';
  let added = null, removed = null, diff = '';
  if (TEXT.test(full)) {
    const now = st && st.size<2_000_000 ? await readText(full) : null;
    if ((o.text !== null || !o.existed) && (now !== null || !st)) ({added, removed, diff} = lineDiff(o.existed ? o.text : null, now));
  }
  const afterSha256=st?.isFile()?await hashFile(full):null;
  const backupSha256=o.backup?(o.backupSha256??=await hashFile(o.backup)):null;
  entries.set(key, {path: o.full, status, added, removed, backup: o.backup, diff,afterSha256,backupSha256});
  await fs.mkdir(dir, {recursive: true});
  const temp=manifestPath+'.'+randomUUID();
  await fs.writeFile(temp, JSON.stringify({version:2,runId,created: new Date().toISOString(), files: [...entries.values()]}, null, 1), 'utf8');
  await fs.rename(temp,manifestPath);
  return '\n저장 위치: ' + o.full + ' [[FILE:' + o.full + '|' + (added ?? '') + '|' + (removed ?? '') + '|' + status + ']] [[UNDO:' + manifestPath + ']]';
}
