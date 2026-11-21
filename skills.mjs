import {isMailAttachmentRequest} from './request-patterns.mjs';
import {skillOverrides} from './skill-availability.mjs';
import {classifySkill,RUNTIME_LABEL} from './skill-runtime.mjs';
import {isCreativeOperation} from './creative-apps.mjs';
// 스킬: 스킬/<이름>/SKILL.md 형식의 작업 설명서. 목록은 매 대화에 보여주고, 필요할 때 skill 도구로 전체를 읽습니다.
import fs from 'node:fs/promises';
import path from 'node:path';
import {managePlugins} from './gemma-plugins.mjs';
import {fileURLToPath} from 'node:url';

export const skillsDir = fileURLToPath(new URL('./스킬/', import.meta.url));

export function skillFrontmatter(text) {
  const m = text.replace(/^﻿/, '').match(/^---\s*\n([\s\S]*?)\n---/);
  const out = {};
  if (m) for (const line of m[1].replace(/\r/g,'').split('\n')) { const kv = line.match(/^(\w+)\s*:\s*(.*)$/); if (kv) out[kv[1]] = kv[2].trim(); }
  return out;
}

const exists = p => fs.access(p).then(() => true, () => false);
// Plugin updates move skills to a new version folder (…\notion\3.0.8\skills\x → …\notion\3.0.9\skills\x).
// When a cached path is gone, use the same skill from the newest version folder of that plugin.
async function currentSkillPath(file) {
  if (!file) return null;
  if (await exists(file)) return file;
  const m = String(file).match(/^(.*[\\/])[^\\/]+([\\/]skills[\\/].+)$/);
  if (!m) return null;
  const versions = await fs.readdir(m[1], {withFileTypes: true}).catch(() => []);
  const found = [];
  for (const v of versions.filter(e => e.isDirectory())) {
    const candidate = m[1] + v.name + m[2];
    const stat = await fs.stat(candidate).catch(() => null);
    if (stat) found.push({candidate, time: stat.mtimeMs});
  }
  found.sort((a, b) => b.time - a.time);
  return found[0]?.candidate ?? null;
}

export async function listSkills() {
  const entries = await fs.readdir(skillsDir, {withFileTypes: true}).catch(() => []);
  const skills = [];
  for (const d of entries.filter(e => e.isDirectory())) {
    const text = await fs.readFile(path.join(skillsDir, d.name, 'SKILL.md'), 'utf8').catch(() => '');
    if (!text) continue;
    const meta = skillFrontmatter(text);
    skills.push({name: meta.name || d.name, folder: d.name, description: meta.description || ''});
  }
  const installed = await managePlugins({tab:'스킬'}).catch(() => ({rows:[]}));
  const cached = await fs.readFile(new URL('./codex-skill-catalog.json',import.meta.url),'utf8')
    .then(JSON.parse).catch(() => []);
  const catalog = installed.rows.map(row => ({
    name:row.name, description:String(row.description||'').replace(/^(?:로컬 모델 가능|연결 서비스 필요|이 앱에서 안 됨) · /,''), path:row.detail, displayName:row.displayName
  })).concat(cached);
  for (const item of catalog) {
    const existing = skills.find(skill => skill.name === item.name);
    if (existing) {
      if (item.displayName && !existing.displayName) existing.displayName = item.displayName;
      continue;
    }
    const source = await currentSkillPath(item.path);
    if (!source) continue;
    skills.push({name:item.name, description:item.description.slice(0,110), source, displayName:item.displayName});
  }
  const states=await skillOverrides();
  // 이 앱에서 실행할 수 없는 스킬(Codex 전용·중복)은 에이전트 목록에서 뺍니다. 고르면 실패하거나 엉뚱한 설명서를 따르게 됩니다.
  return skills.map(item=>({...item,...classifySkill(item)})).filter(item=>!states.has(item.name) && item.runtime!=='unsupported');
}

// Keep the complete catalog available to the tool. Only descriptions relevant to
// the user's words need to travel with every model call in a task.
export function desktopOperation(request){
  return isCreativeOperation(request)||/(?:화면|바탕\s*화면|데스크톱|스크린\s*샷|스샷).{0,16}(?:녹화|클릭|캡처|캡쳐|찍|조작)|(?:마우스|키보드|탐색기|메모장|계산기|그림판|오캠|obs).{0,24}(?:조작|클릭|입력|열어|실행|녹화)|(?:record|capture|screenshot) (?:my |the )?(?:desktop|screen)/i.test(request);
}

export function relevantSkills(skills, request) {
  const query = String(request ?? '').toLowerCase();
  const mailAttachment = isMailAttachmentRequest(query); // request-patterns.mjs
  const ids = new Set(query.split(/[^a-z0-9:_-]+/));
  const words = [...new Set(query.match(/[a-z0-9]{2,}|[가-힣]{2,}/g) || [])];
  const terms = words.map(word => word.replace(/(?:에서|으로|까지|에게|을|를|의|에|도|와|과)$/, ''))
    .filter(word => word.length >= 2 && !['스킬','작업','하고','사용','해서','해줘','주세요','확인'].includes(word));
  const exact = [], ranked = [];
  for (const skill of skills) {
    const id = skill.name.toLowerCase();
    if ((id==='computer-use:computer-use' && desktopOperation(request)) ||
        (id==='creative-apps' && isCreativeOperation(request)) ||
        (id==='gmail-attachments' && mailAttachment) ||
        ids.has(id) || (skill.displayName && query.includes(skill.displayName.toLowerCase()))) {
      exact.push(skill);
      continue;
    }
    const label = (id + ' ' + (skill.displayName || '')).toLowerCase();
    const description = skill.description.toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (label.includes(term)) score += 3;
      if (description.includes(term)) score++;
    }
    if (score) ranked.push({skill, score});
  }
  ranked.sort((a,b) => b.score - a.score);
  exact.sort((a,b)=>Number(b.name==='computer-use:computer-use')-Number(a.name==='computer-use:computer-use'));
  return exact.concat(ranked.slice(0, Math.max(0, 8 - exact.length)).map(item => item.skill));
}

export async function loadSkill(name, catalog) {
  const skills = catalog ?? await listSkills();
  const states=await skillOverrides();
  if (!String(name ?? '').trim() || String(name).trim() === '목록')
    return skills.filter(s=>!states.has(s.name)).map(s => s.name + (s.displayName ? ' (' + s.displayName + ')' : '') + (s.runtime==='connector'?' ['+s.reason+']':'') + ': ' + s.description).join('\n');
  const s = skills.find(x => x.name === String(name).trim() || x.folder === String(name).trim() || x.displayName === String(name).trim());
  if (!s) throw Error('그런 스킬이 없습니다. 있는 스킬: ' + skills.map(x => x.name).join(', '));
  if(states.has(s.name))throw Error('사용 중지되었거나 제거된 스킬입니다.');
  const kind=s.runtime?s:classifySkill(s);
  if(kind.runtime==='unsupported')throw Error('이 앱에서는 쓸 수 없는 스킬입니다('+kind.reason+'). 이 PC의 도구로 직접 하세요.');
  if(s.source){
    const guide=await fs.readFile(s.source,'utf8');
    return '로컬 Gemma에서 적용할 작업 설명서. 서비스 도구는 plugin_search로 실제 이름과 입력 형식을 확인하고 plugin_call로 호출한다. 예약은 schedule_add, 채팅 이름 변경은 rename_chat, 캔버스는 canvas, 하위 작업은 delegate를 쓴다. 전용 화면이나 실행기가 없으면 성공으로 보고하지 않는다. 관련 자료 기준 폴더: '+path.dirname(s.source)+'\n\n'+guide;
  }
  const dir = path.join(skillsDir, s.folder);
  let text = (await fs.readFile(path.join(dir, 'SKILL.md'), 'utf8')).replace(/^﻿/, '').replaceAll('<스킬폴더>', dir);
  const cfgPath = path.join(dir, 'config.json');
  const cfg = await fs.readFile(cfgPath, 'utf8').then(t => JSON.parse(t.replace(/^﻿/, ''))).catch(() => null);
  if (cfg) {
    const empty = Object.entries(cfg).filter(([, v]) => v === '' || (typeof v === 'object' && v && !Object.keys(v).length)).map(([k]) => k);
    text += '\n\n[설정 파일] ' + cfgPath + (empty.length ? '\n아직 비어 있는 설정: ' + empty.join(', ') + ' → 사용자에게 무엇을 넣어야 하는지 안내하세요. 토큰·비밀번호는 사용자가 직접 넣습니다.' : '\n설정 완료');
  }
  return text;
}
