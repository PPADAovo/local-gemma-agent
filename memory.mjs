// 장기 기억 (OpenClaw 방식): 마크다운 파일로 기억을 남기고, 매 대화마다 필요한 부분을 모델에게 보여줍니다.
//   기억/MEMORY.md      오래 기억할 사실·선호
//   기억/USER.md        사용자 프로필
//   기억/HEARTBEAT.md   30분마다 점검할 항목
//   기억/노트/YYYY-MM-DD.md  날짜별 노트(대화 요약, 메모)
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const memoryDir = fileURLToPath(new URL('./기억/', import.meta.url));
const notesDir = path.join(memoryDir, '노트');
const file = name => path.join(memoryDir, name);

export function today(d = new Date()) {
  const k = new Date(d.getTime() + 9 * 3600e3); // 한국 시간
  return k.toISOString().slice(0, 10);
}
function clock(d = new Date()) {
  return new Date(d.getTime() + 9 * 3600e3).toISOString().slice(11, 16);
}

const TEMPLATES = {
  'MEMORY.md': '# 장기 기억\n\n에이전트가 오래 기억할 사실과 선호입니다. 직접 고쳐도 됩니다.\n\n',
  // 새 사용자는 아직 호칭을 모릅니다. 시작 안내(onboard)나 대화에서 알게 되면 profile로 채웁니다.
  'USER.md': '# 사용자 프로필\n\n',
  'HEARTBEAT.md': '# 하트비트 점검 목록\n\n30분마다 에이전트가 이 목록을 확인합니다. 확인할 일이 없으면 조용히 넘어갑니다.\n아래에 "- " 로 시작하는 줄을 추가하세요. 예:\n<!-- - 작업공간에 새로 생긴 파일이 있으면 알려주기 -->\n'
};

export async function ensureMemory() {
  await fs.mkdir(notesDir, {recursive: true});
  for (const [name, body] of Object.entries(TEMPLATES)) {
    await fs.writeFile(file(name), body, {flag: 'wx'}).catch(e => { if (e.code !== 'EEXIST') throw e; });
  }
}

async function readText(p) {
  return (await fs.readFile(p, 'utf8').catch(e => { if (e.code === 'ENOENT') return ''; throw e; })).replace(/^﻿/, '');
}

async function append(p, text) {
  await fs.mkdir(path.dirname(p), {recursive: true});
  await fs.appendFile(p, text, 'utf8');
}

// 대화 시작 시 모델에게 보여줄 기억 (길이 제한)
export async function memoryContext() {
  await ensureMemory();
  const user = (await readText(file('USER.md'))).slice(0, 2000);
  const memory = (await readText(file('MEMORY.md'))).slice(-3500);
  const t = today(), y = today(new Date(Date.now() - 864e5));
  const notes = ((await readText(path.join(notesDir, y + '.md'))).slice(-700) + '\n' + (await readText(path.join(notesDir, t + '.md'))).slice(-1500)).trim();
  return {user, memory, notes};
}

export async function remember(text) {
  await ensureMemory();
  const entry = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  if (!entry) throw Error('저장할 내용이 비어 있습니다.');
  const current = await readText(file('MEMORY.md'));
  if (current.includes(entry)) return '이미 기억하고 있는 내용입니다.';
  await append(file('MEMORY.md'), '- ' + entry + ' (' + today() + ')\n');
  return 'MEMORY.md에 저장: ' + entry;
}

export async function rememberUser(text) {
  await ensureMemory();
  const entry = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!entry) throw Error('저장할 내용이 비어 있습니다.');
  const current = await readText(file('USER.md'));
  if (current.includes(entry)) return '이미 프로필에 있는 내용입니다.';
  await append(file('USER.md'), '- ' + entry + '\n');
  return 'USER.md에 저장: ' + entry;
}

export async function note(text, d = new Date()) {
  await ensureMemory();
  const entry = String(text || '').trim().slice(0, 2000);
  if (!entry) throw Error('메모 내용이 비어 있습니다.');
  const p = path.join(notesDir, today(d) + '.md');
  if (!(await readText(p))) await append(p, '# ' + today(d) + ' 노트\n\n');
  await append(p, '- ' + clock(d) + ' ' + entry.replace(/\n/g, '\n  ') + '\n');
  return '오늘 노트에 저장: ' + p;
}

// 기억 전체에서 검색
export async function recall(query) {
  await ensureMemory();
  const words = String(query || '').toLowerCase().split(/\s+/).filter(w => w.length > 1);
  if (!words.length) throw Error('검색어가 필요합니다.');
  const sources = [['MEMORY.md', file('MEMORY.md')], ['USER.md', file('USER.md')]];
  for (const f of (await fs.readdir(notesDir)).filter(f => f.endsWith('.md')).sort().reverse().slice(0, 120)) sources.push(['노트/' + f, path.join(notesDir, f)]);
  const hits = [];
  for (const [label, p] of sources) {
    for (const line of (await readText(p)).split(/\r?\n/)) {
      const l = line.toLowerCase();
      const score = words.filter(w => l.includes(w)).length;
      if (score) hits.push({score, text: label + ': ' + line.trim()});
    }
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.length ? hits.slice(0, 25).map(h => h.text).join('\n') : '기억에서 찾지 못했습니다: ' + query;
}

// 드리밍: 최근 노트와 MEMORY.md를 모델로 정리해 중복을 없애고 오래 남길 내용만 남깁니다.
export async function dream(chat) {
  await ensureMemory();
  const memory = await readText(file('MEMORY.md'));
  const user = await readText(file('USER.md'));
  const recentNotes = [];
  for (const f of (await fs.readdir(notesDir)).filter(f => f.endsWith('.md')).sort().slice(-3)) recentNotes.push(await readText(path.join(notesDir, f)));
  const prompt = [
    {role: 'system', content: 'You consolidate an assistant\'s long-term memory. Output JSON {"memory": string, "user": string, "summary": string}. memory = full new MEMORY.md in Korean markdown: keep lasting facts, preferences, projects, decisions; merge duplicates; drop one-off chatter; keep dates. user = full new USER.md (profile facts only). Never invent facts. summary = one Korean sentence of what changed.'},
    {role: 'user', content: 'MEMORY.md:\n' + memory.slice(-8000) + '\n\nUSER.md:\n' + user.slice(-3000) + '\n\n최근 노트:\n' + recentNotes.join('\n\n').slice(-8000)}
  ];
  const out = JSON.parse(await chat(prompt, {type: 'object', properties: {memory: {type: 'string'}, user: {type: 'string'}, summary: {type: 'string'}}, required: ['memory', 'user', 'summary']}));
  if (!out.memory || out.memory.length < Math.min(40, memory.length / 4)) throw Error('정리 결과가 너무 짧아 적용하지 않았습니다.');
  const backup = path.join(memoryDir, '백업', today());
  await fs.mkdir(backup, {recursive: true});
  await fs.writeFile(path.join(backup, 'MEMORY.md'), memory);
  await fs.writeFile(path.join(backup, 'USER.md'), user);
  await fs.writeFile(file('MEMORY.md'), out.memory.trim() + '\n');
  if (out.user && out.user.length > 10) await fs.writeFile(file('USER.md'), out.user.trim() + '\n');
  await note('🌙 드리밍: ' + out.summary);
  return out.summary;
}

export async function heartbeatItems() {
  await ensureMemory();
  return (await readText(file('HEARTBEAT.md'))).split(/\r?\n/).filter(l => /^\s*-\s+\S/.test(l)).map(l => l.replace(/^\s*-\s+/, '').trim());
}
