// 클라우드 두뇌 연결: Gemini(무료 API 키) · Claude · GPT를 HTTP API로 직접 부릅니다.
// - 명령줄(agy/cmd.exe)을 거치지 않으므로 줄바꿈·길이 제한(8,191자)·명령 끼어들기 문제가 없습니다.
// - 키는 사용자가 직접 '두뇌설정.json'에 넣거나 환경 변수(GEMINI_API_KEY, ANTHROPIC_API_KEY, OPENAI_API_KEY)로 설정합니다.
//   AI는 키를 입력하거나 화면에 출력하지 않습니다.
// - order 순서대로 시도하고, 키가 없는 서비스는 건너뜁니다. 한도 초과(429)·오류면 다음 서비스로 넘어갑니다.
import {appDataDir} from './app-data.mjs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHash, randomUUID} from 'node:crypto';
import {record, apiReason} from './brain-health.mjs';
import {estimateTokens} from './context-size.mjs';

// 모델 버튼 옆 "컨텍스트 사용량" 링용: 클라우드 모델이 한 번 답할 때마다 쓴 토큰을 앱에 알립니다.
// API는 응답에 적힌 실제 토큰 수를 쓰고, 구독(CLI)은 토큰 수를 주지 않으므로 글자 수로 어림합니다(estimated).
// 한도는 각 서비스의 기본 모델 컨텍스트 창입니다(Gemini Pro/Flash 1,048,576 · Claude Sonnet/Haiku 5.5 1M · GPT-5 400K).
export const CONTEXT_LIMIT = {gemini: 1048576, claude: 1000000, gpt: 400000};
let lastUsage = null;
function usageFrom(p, r) {
  const n = v => Number.isFinite(v) && v >= 0 ? v : 0;
  if (p === 'gemini') { const u = r.usageMetadata || {}; return n(u.totalTokenCount) || n(u.promptTokenCount) + n(u.candidatesTokenCount); }
  if (p === 'claude') { const u = r.usage || {}; return n(u.input_tokens) + n(u.cache_read_input_tokens) + n(u.cache_creation_input_tokens) + n(u.output_tokens); }
  const u = r.usage || {}; return n(u.total_tokens) || n(u.prompt_tokens) + n(u.completion_tokens);
}
export function reportUsage(provider, used, estimated) {
  const limit = CONTEXT_LIMIT[provider];
  if (!limit || !Number.isFinite(used) || used <= 0) return;
  try { process.stderr.write('@usage ' + JSON.stringify({used: Math.round(used), limit, provider: NAMES[provider], estimated: Boolean(estimated)}) + '\n'); } catch {}
}

const CONFIG = fileURLToPath(new URL('./두뇌설정.json', import.meta.url));
const DEFAULTS = {
  order: ['gemini', 'claude', 'gpt'],
  // 정확도 우선: 앞의 모델부터 시도하고, 한도 초과·모델 없음일 때만 다음(가벼운) 모델로 내려갑니다.
  // 마지막 gemini-3.1-flash-lite는 한도·장애 때 빠르게 답하는 예비 모델입니다(2026-11-14 확인: 2초대 응답).
  gemini: {key: '', models: ['gemini-pro-latest', 'gemini-flash-latest', 'gemini-3.1-flash-lite'], url: 'https://generativelanguage.googleapis.com'},
  claude: {key: '', models: ['claude-sonnet-5-5', 'claude-haiku-5-5'], url: 'https://api.anthropic.com'},
  gpt: {key: '', models: ['gpt-5', 'gpt-5-mini'], url: 'https://api.openai.com'},
  timeoutSec: 300,
  // 모델 하나를 기다리는 최대 시간(초). 넘으면 다음 모델로 넘어갑니다(한 모델이 멈춰 5분씩 기다리지 않게).
  attemptTimeoutSec: 60,
  actionTimeoutSec: 20,
  maxOutputTokens: 4096
};
const ENV = {gemini: 'GEMINI_API_KEY', claude: 'ANTHROPIC_API_KEY', gpt: 'OPENAI_API_KEY'};
const NAMES = {gemini: 'Gemini', claude: 'Claude', gpt: 'GPT'};

const configCache = new Map();
export async function loadConfig(file = CONFIG) {
  const files = [file, ...(file === CONFIG && process.platform === 'win32' && process.env.LOCALAPPDATA
    ? ['gemini','gpt','claude'].map(p => path.join(appDataDir(), p + '.dpapi')) : [])];
  const stamps = await Promise.all(files.map(async name => {
    try { const s = await fs.stat(name, {bigint:true}); return [String(name), String(s.size), String(s.mtimeNs), String(s.ctimeNs), String(s.ino)]; }
    catch (error) { if (error.code === 'ENOENT') return [String(name), 'missing']; throw error; }
  }));
  const fingerprint = createHash('sha256').update(JSON.stringify([stamps, ...Object.values(ENV).map(key => process.env[key] || '')])).digest('hex');
  const cached = configCache.get(file);
  if (cached?.fingerprint === fingerprint) return structuredClone(cached.value);
  const value = await readConfig(file);
  if (configCache.size >= 8) configCache.delete(configCache.keys().next().value);
  configCache.set(file, {fingerprint, value});
  return structuredClone(value);
}

async function readConfig(file) {
  let user = {};
  try { user = JSON.parse((await fs.readFile(file, 'utf8')).replace(/^﻿/, '')); } catch (e) { if (e.code !== 'ENOENT' && !(e instanceof SyntaxError)) throw e; }
  const c = {...DEFAULTS, ...user};
  for (const p of ['gemini', 'claude', 'gpt']) {
    c[p] = {...DEFAULTS[p], ...(user[p] || {})};
    if(file===CONFIG){c[p].key=process.env[ENV[p]]||'';c[p].url=DEFAULTS[p].url;}
    else if(!c[p].key)c[p].key=process.env[ENV[p]]||'';
    if (typeof user[p]?.model === 'string' && user[p].model) c[p].models = [user[p].model];
    c[p].models = (Array.isArray(c[p].models) ? c[p].models : DEFAULTS[p].models).filter(m => typeof m === 'string' && m.trim());
  }
  if(file===CONFIG && process.platform==='win32' && process.env.LOCALAPPDATA){
    for(const p of ['gemini','gpt','claude']){
      const secret=path.join(appDataDir(),p+'.dpapi');
      if(!await fs.stat(secret).catch(()=>null))continue;
      const script='Add-Type -AssemblyName System.Security; [Console]::Write([Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($env:GEMMA_SECRET_FILE),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)))';
      const {stdout}=await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,env:{...process.env,GEMMA_SECRET_FILE:secret}});
      c[p].key=stdout.trim();
      c[p].url=DEFAULTS[p].url;
    }
  }
  c.order = (Array.isArray(c.order) ? c.order : DEFAULTS.order).filter(p => ['gemini', 'claude', 'gpt'].includes(p));
  return c;
}

export async function providers(file) {
  const c = await loadConfig(file);
  return c.order.filter(p => typeof c[p].key === 'string' && c[p].key.trim().length > 10);
}

const mime = b64 => String(b64).startsWith('iVBOR') ? 'image/png' : String(b64).startsWith('R0lG') ? 'image/gif' : String(b64).startsWith('UklG') ? 'image/webp' : 'image/jpeg';

// 같은 역할이 연속되면 하나로 합칩니다(Claude·Gemini는 user/assistant가 번갈아 와야 함).
function normalize(messages) {
  const out = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    const text = String(m.content ?? '').slice(-8000);
    const images = Array.isArray(m.images) ? m.images : [];
    const last = out.at(-1);
    const part={text,images:[...images]};
    if (last && last.role === role) { last.text += '\n\n' + text; last.images.push(...images); last.parts.push(part); }
    else out.push({role, text, images: [...images],parts:[part]});
  }
  if (!out.length || out[0].role !== 'user') out.unshift({role: 'user', text: '(대화 시작)', images: []});
  // 오래된 화면은 호출자가 정리합니다. 원본 참조 이미지와 현재 화면을 전송 단계에서 버리면 비교 작업이 불가능합니다.
  // 글이 너무 길면 이미지 문맥을 보존하며 오래된 텍스트 대화 쌍부터 덜어 냅니다.
  let total = out.reduce((n, m) => n + m.text.length, 0);
  while (total > 120000 && out.length > 2) {
    const at=out.findIndex((m,i)=>i+1<out.length&&!m.images.length&&!out[i+1].images.length);
    if(at<0)break;
    total-=out[at].text.length+out[at+1].text.length;out.splice(at,2);
  }
  if (!out.length) out.push({role: 'user', text: '(내용 없음)', images: []});
  return out;
}
const messageParts=m=>m.parts||[{text:m.text,images:m.images}];

async function post(url, headers, body, timeoutSec, control={}) {
  control.signal?.throwIfAborted();
  const left=Math.min(timeoutSec*1000,Number.isFinite(control.deadline)?control.deadline-Date.now():Infinity);
  if(left<=0)throw Object.assign(Error('작업 시간 제한에 도달했습니다.'),{code:'TASK_DEADLINE'});
  const timeout=AbortSignal.timeout(Math.ceil(left));
  const signal=control.signal?AbortSignal.any([control.signal,timeout]):timeout;
  const r = await fetch(url, {method: 'POST', headers: {'content-type': 'application/json', ...headers}, body: JSON.stringify(body), redirect: 'error', signal});
  const text = await r.text();
  if (!r.ok) {
    const err = Error('HTTP ' + r.status + ': ' + text.replace(/\s+/g, ' ').slice(0, 300));
    // Google puts the retry interval after its long quota explanation. Preserve it
    // before truncating the display message, without retaining response contents.
    try {
      const error = JSON.parse(text).error;
      const retry = error?.details?.find(d => String(d['@type']).endsWith('/google.rpc.RetryInfo'))?.retryDelay;
      if (/^\d+(?:\.\d+)?s$/.test(retry || '')) err.retryMs = Number(retry.slice(0, -1)) * 1000;
      err.zeroQuota = /limit:\s*0\b/i.test(error?.message || '');
    } catch {}
    err.status = r.status; throw err;
  }
  return JSON.parse(text);
}

async function callOne(p, c, system, msgs, json, model) {
  let config=c;
  for(let attempt=0;attempt<3;attempt++){
    try{return await callAttempt(p,config,system,msgs,json,model);}
    catch(error){
      if(error.code!=='OUTPUT_TRUNCATED' || attempt===2 || Number(config.maxOutputTokens)>=16384)throw error;
      config={...config,maxOutputTokens:Math.min(16384,Math.max(4096,Number(config.maxOutputTokens)*2))};
    }
  }
}
const truncatedOutput=()=>Object.assign(Error('모델 답변이 출력 한도에서 잘려 완전한 응답을 받지 못했습니다.'),{code:'OUTPUT_TRUNCATED'});
async function callAttempt(p, c, system, msgs, json, model) {
  const cfg = {...c[p], model}, max = c.maxOutputTokens, t = Math.min(c.timeoutSec, c.attemptTimeoutSec || c.timeoutSec);
  if (p === 'gemini') {
    const body = {
      contents: msgs.map(m => ({role: m.role === 'assistant' ? 'model' : 'user', parts: messageParts(m).flatMap(p=>[...(p.text.trim()?[{text:p.text}]:[]),...p.images.map(d=>({inline_data:{mime_type:mime(d),data:d}}))])})),
      generationConfig: {maxOutputTokens: max, temperature: 0, ...(json ? {responseMimeType: 'application/json'} : {})}
    };
    if (system) body.systemInstruction = {parts: [{text: system}]};
    const r = await post(cfg.url.replace(/\/$/, '') + '/v1beta/models/' + encodeURIComponent(cfg.model) + ':generateContent', {'x-goog-api-key': cfg.key}, body, t,c);
    lastUsage = usageFrom(p, r);
    if(r.candidates?.[0]?.finishReason==='MAX_TOKENS')throw truncatedOutput();
    const text = (r.candidates?.[0]?.content?.parts || []).map(x => x.text || '').join('');
    if (!text.trim()) throw Error('빈 응답 (' + (r.candidates?.[0]?.finishReason || r.promptFeedback?.blockReason || '이유 없음') + ')');
    return text;
  }
  if (p === 'claude') {
    const body = {
      model: cfg.model, max_tokens: max,
      ...(system ? {system} : {}),
      messages: msgs.map(m => ({role: m.role, content: messageParts(m).flatMap(p=>[...(p.text.trim()?[{type:'text',text:p.text}]:[]),...p.images.map(d=>({type:'image',source:{type:'base64',media_type:mime(d),data:d}}))])}))
    };
    const r = await post(cfg.url.replace(/\/$/, '') + '/v1/messages', {'x-api-key': cfg.key, 'anthropic-version': '2023-06-01'}, body, t,c);
    lastUsage = usageFrom(p, r);
    if(r.stop_reason==='max_tokens')throw truncatedOutput();
    const text = (r.content || []).filter(x => x.type === 'text').map(x => x.text).join('');
    if (!text.trim()) throw Error('빈 응답');
    return text;
  }
  const body = {
    model: cfg.model, max_completion_tokens: max,
    messages: [...(system ? [{role: 'system', content: system}] : []), ...msgs.map(m => ({role: m.role, content: m.images.length ? messageParts(m).flatMap(p=>[...(p.text.trim()?[{type:'text',text:p.text}]:[]),...p.images.map(d=>({type:'image_url',image_url:{url:'data:'+mime(d)+';base64,'+d}}))]) : m.text}))],
    ...(json ? {response_format: {type: 'json_object'}} : {})
  };
  const r = await post(cfg.url.replace(/\/$/, '') + '/v1/chat/completions', {authorization: 'Bearer ' + cfg.key}, body, t,c);
  lastUsage = usageFrom(p, r);
  if(r.choices?.[0]?.finish_reason==='length')throw truncatedOutput();
  const text = r.choices?.[0]?.message?.content || '';
  if (!text.trim()) throw Error('빈 응답');
  return text;
}

// messages: [{role:'system'|'user'|'assistant', content, images?:[base64]}]
// format이 있으면 JSON 객체 문자열을 돌려줍니다. 결과에 어느 서비스가 답했는지 함께 줍니다.
export async function chat(messages, {format = null, onProgress = () => {}, file, provider,deadline,signal} = {}) {
  const loadedConfig = await loadConfig(file);
  // Selecting the next tool should not block the whole workflow for a minute.
  // Keep the longer generation window for prose, planning and verification.
  const actionTimeout = Number(loadedConfig.actionTimeoutSec);
  const c = {...loadedConfig,deadline,signal,...(format?.properties?.tool && Number.isFinite(actionTimeout) && actionTimeout > 0
    ? {attemptTimeoutSec:Math.min(loadedConfig.attemptTimeoutSec || loadedConfig.timeoutSec, actionTimeout)} : {})};
  const modelHealth = await readModelHealth(file);
  const list = provider ? [provider] : c.order.filter(p => typeof c[p].key === 'string' && c[p].key.trim().length > 10);
  if(provider && !c[provider]?.key){if(!file)await record({['api-'+provider]:{ok:false,reason:'키 없음'}});throw Error(NAMES[provider]+" API 키를 내 AI 연결 창 또는 "+ENV[provider]+"에 설정해 주세요.");}
  // 모델 메뉴의 빨간색 표시용: 성공하면 정상, 모든 시도가 크레딧·키 문제로 실패하면 사용 불가로 기록합니다.
  const mark = async (ok, reason) => { if (provider && !file) await record({['api-' + provider]: {ok, reason}}); };
  const kinds = [];
  if (!list.length) throw Object.assign(Error('클라우드 두뇌 키가 없습니다. 두뇌설정.json에 Gemini 키를 넣어 주세요.'), {code: 'NO_CLOUD_KEY'});
  let system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
  if (format) system += '\n\nReturn ONLY one JSON object (no code fence, no extra text) matching this JSON schema:\n' + JSON.stringify(format);
  const msgs = normalize(messages);
  const failures = [];
  // 지금 무엇을 묻는지 사람이 알 수 있게 보여 줍니다(답 형식으로 판단). 기다리는 동안 5초마다 걸린 시간을 갱신합니다.
  const purpose = askPurpose(format);
  for (const p of list) {
    const modelKey = model => createHash('sha256').update(JSON.stringify([p, c[p].url, c[p].key, model])).digest('hex');
    const models = c[p].models.filter(model => {
      const state = modelHealth[modelKey(model)];
      if (!state || state.until <= Date.now()) return true;
      // 건너뛰는 안내는 채팅에 띄우지 않습니다(실패 목록에만 남김).
      failures.push(NAMES[p] + ' ' + model + ': ' + state.reason + ' (약 ' + Math.ceil((state.until - Date.now()) / 1000) + '초 뒤 재시도)');
      return false;
    });
    for (const model of models) {
      const label = NAMES[p] + '(' + model.replace(/^gemini-/, '') + ') · ' + purpose;
      const started = Date.now();
      onProgress(label + ' (0초)');
      const tick = setInterval(() => onProgress(label + ' (' + Math.round((Date.now() - started) / 1000) + '초)'), 5000);
      try {
        let text;
        try {
          try { text = await callOne(p, c, system, msgs, Boolean(format), model); }
          catch (e) {
            // 503/500(일시 장애)은 잠깐 기다렸다가 같은 모델로 한 번 더 시도합니다.
            if (![500, 503].includes(e.status)) throw e;
            onProgress(label + ' · 일시 장애라 3초 뒤 다시 시도');
            await new Promise(r => setTimeout(r, 3000));
            text = await callOne(p, c, system, msgs, Boolean(format), model);
          }
        } finally { clearInterval(tick); }
        if (!format) { await mark(true); return {text, provider: p, model}; }
        let json = extractJson(text);
        // 무엇을 하기로 했는지 한 줄로 보여 줍니다(다음 행동의 thought).
        if (json && typeof json.thought === 'string' && json.thought.trim()) onProgress(NAMES[p] + ' 판단 · ' + json.thought.trim().replace(/\s+/g, ' ').slice(0, 80));
        if (!json) { // 형식이 틀리면 같은 모델에게 한 번 더 바로잡게 함
          text = await callOne(p, c, system, [...msgs, {role: 'assistant', text: text.slice(0, 4000), images: []}, {role: 'user', text: '위 답은 형식이 틀렸습니다. 스키마에 맞는 JSON 객체 하나만 다시 보내세요.', images: []}], true, model);
          json = extractJson(text);
        }
        if (!json) throw Error('JSON을 찾지 못함: ' + text.slice(0, 120));
        await mark(true);
        return {text: JSON.stringify(json), provider: p, model};
      } catch (e) {
        if(signal?.aborted)throw signal.reason||e;
        if(e.code==='TASK_DEADLINE' || (Number.isFinite(deadline)&&Date.now()>=deadline))throw Object.assign(Error('작업 시간 제한에 도달했습니다.'),{code:'TASK_DEADLINE'});
        // More providers cannot repair this request's exhausted output budget.
        // Do not multiply the bounded retries by every configured fallback model.
        if(e.code==='OUTPUT_TRUNCATED')throw e;
        const timedOut = e.name === 'TimeoutError' || e.name === 'AbortError';
        const why = e.status === 429 ? (e.zeroQuota ? '이 키의 해당 모델 사용 한도 0' : '해당 모델 요청 한도 초과') : e.status === 404 ? '모델 없음' : [500, 503].includes(e.status) ? '서비스 일시 장애' : timedOut ? (c.attemptTimeoutSec || c.timeoutSec) + '초 안에 답 없음' : e.status === 401 || e.status === 403 ? '키가 맞지 않거나 권한 없음' : e.message;
        // 한도·장애·무응답·없는 모델은 잠시 건너뜁니다(같은 작업의 다음 단계에서 또 기다리지 않게).
        if ([429, 404, 503, 500].includes(e.status) || timedOut) {
          // A zero allocation is not a transient rate limit; do not retry it every few minutes.
          const ms = Math.min(24 * 60 * 60e3, Math.max(1000, e.zeroQuota ? 24 * 60 * 60e3 : e.retryMs || (e.status === 429 ? 10 * 60e3 : e.status === 404 ? 60 * 60e3 : 3 * 60e3)));
          coolDown(p, model, ms);
          const key = modelKey(model), state = {until: Date.now() + ms, reason: why};
          modelHealth[key] = state;
          await saveModelHealth(file, key, state);
        }
        kinds.push(apiReason(e.message));
        failures.push(NAMES[p] + ' ' + model + ': ' + (apiReason(e.message) === '크레딧 부족' ? '크레딧 부족' : why));
        onProgress(NAMES[p] + ' ' + model + ' 실패 · ' + why.slice(0, 40));
        if (e.status === 401 || e.status === 403) break;
      }
    }
  }
  if (kinds.length && kinds.every(Boolean)) await mark(false, kinds[0]);
  throw Error('클라우드 두뇌가 모두 실패했습니다.\n' + failures.join('\n'));
}

// Each desktop request starts a new Node process. Keep temporary model failures
// across requests, scoped to a hash of account key + endpoint + model. Never save
// keys, prompts, server response bodies or account identifiers here.
const modelHealthPath = file => file ? file + '.models.json' : path.join(appDataDir(),'model-health.json');
async function readModelHealth(file) {
  try {
    const data = JSON.parse(await fs.readFile(modelHealthPath(file), 'utf8'));
    return Object.fromEntries(Object.entries(data).filter(([key, value]) => /^[a-f0-9]{64}$/.test(key) && Number.isFinite(value?.until) && value.until > Date.now() && typeof value.reason === 'string'));
  } catch { return {}; }
}
async function saveModelHealth(file, key, state) {
  const dest = modelHealthPath(file), temp = dest + '.' + randomUUID() + '.tmp';
  try {
    const data = await readModelHealth(file); data[key] = state;
    await fs.mkdir(path.dirname(dest), {recursive: true});
    await fs.writeFile(temp, JSON.stringify(data), 'utf8');
    await fs.rename(temp, dest);
  } catch { await fs.unlink(temp).catch(() => {}); }
}

// 잠시 쉬게 할 모델 기록(이 프로세스 안에서만 유지). 값: 다시 시도해도 되는 시각.
const cooling = new Map();
export const coolingDown = (p, model) => (cooling.get(p + '/' + model) || 0) > Date.now();
export const coolDown = (p, model, ms) => cooling.set(p + '/' + model, Date.now() + ms);

// 답 형식(JSON 스키마의 칸 이름)으로 지금 무엇을 묻는지 판단합니다.
export function askPurpose(format) {
  const keys = Object.keys(format?.properties || {});
  if (keys.includes('tool')) return '다음 행동을 고르는 중';
  if (keys.includes('goal') || keys.includes('kind')) return '요청을 이해하는 중';
  if (keys.some(k => ['verified', 'checks', 'quote', 'covered', 'met'].includes(k))) return '결과를 확인하는 중';
  if (keys.includes('memory')) return '기억할 내용을 고르는 중';
  if (keys.includes('decision')) return '막힌 단계를 다시 판단하는 중';
  return '답변을 쓰는 중';
}

export function extractJson(text) {
  const s = String(text).trim();
  try { const v = JSON.parse(s); if (v && typeof v === 'object' && !Array.isArray(v)) return v; } catch {}
  const m = s.match(/```(?:json)?\s*([\s\S]*?)```/) || s.match(/(\{[\s\S]*\})/);
  if (!m) return null; try { return JSON.parse(m[1]); } catch { return null; }
}

// 연결 확인: 각 서비스에 짧은 질문을 보내 실제로 답하는지 봅니다(키 값은 출력하지 않음).
export async function check(file) {
  const c = await loadConfig(file), out = [];
  for (const p of ['gemini', 'claude', 'gpt']) {
    if (!(c[p].key || '').trim()) { out.push(NAMES[p] + ': 키 없음 (건너뜀)'); continue; }
    for (const model of c[p].models) {
      try { const t = await callOne(p, c, '', [{role: 'user', text: 'OK 한 단어로만 답하세요.', images: []}], false, model); out.push(NAMES[p] + ' (' + model + '): 연결됨 · "' + t.trim().slice(0, 20) + '"'); }
      catch (e) { out.push(NAMES[p] + ' (' + model + '): 실패 · ' + (e.status === 429 ? '한도 초과' : e.status === 404 ? '모델 없음' : e.status === 401 || e.status === 403 ? '키 오류' : e.message.slice(0, 120))); }
    }
  }
  return out.join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1] && process.argv[2] === '--check') {
  check().then(r => { console.log(r); }, e => { console.error(e.message); process.exitCode = 1; });
}

// 구독 연결(sub-*): 로그인한 계정의 CLI를 씁니다. API 키·API 요금 없이 각 서비스의 구독 한도로 답합니다.
const SUBSCRIPTION={gemini:'./gemini-account.mjs',gpt:'./codex-account.mjs',claude:'./claude-account.mjs'};
export async function selectedBrain(provider){
  if(provider.startsWith('sub-')){
    const file=SUBSCRIPTION[provider.slice(4)];
    if(!file)throw Error('알 수 없는 모델 선택');
    const mod=await import(file);
    // 로그인·설치 상태를 메뉴 빨간색 표시용으로 기록합니다.
    const id=provider.slice(4);
    // 구독 CLI는 토큰 수를 알려 주지 않으므로 보낸 글과 받은 답의 길이로 어림해 사용량 링에 보냅니다.
    const complete=mod.complete&&(async(messages,...rest)=>{const text=await mod.complete(messages,...rest);reportUsage(id,estimateTokens(messages)+Math.ceil(String(text||'').length/2),true);return text;});
    return {...mod,...(complete?{complete}:{}),async status(){const s=await mod.status();await record({[provider]:s.ok?{ok:true}:{ok:false,reason:/설치/.test(s.message||'')?'설치 필요':'로그인 필요'}});return s;}};
  }
  const apiOnly=provider.startsWith('api-');
  if(apiOnly)provider=provider.slice(4);
  // Legacy cloud names and explicit API names share the same HTTP transport.
  if(!['gemini','gpt','claude'].includes(provider))throw Error('알 수 없는 모델 선택');
  return {
    async status(){const c=await loadConfig();return {ok:Boolean(c[provider].key),message:NAMES[provider]+' 연결에는 '+ENV[provider]+' 또는 내 AI 연결 창에 등록한 API 키가 필요합니다.'};},
    async complete(messages,format,options){
      lastUsage=null;
      const r=await chat(messages,{...options,format,provider});
      reportUsage(r.provider,lastUsage||estimateTokens(messages)+Math.ceil(String(r.text||'').length/2),!lastUsage);
      return r.text;
    }
  };
}
