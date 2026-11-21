// 예약 작업(Automations)과 하트비트·드리밍 시각 관리. 앱이 켜져 있는 동안 1분마다 tick으로 확인합니다.
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {memoryDir, today} from './memory.mjs';

const tasksFile = path.join(memoryDir, '예약작업.json');
const stateFile = path.join(memoryDir, '상태.json');
const DAYS = {sun:0,mon:1,tue:2,wed:3,thu:4,fri:5,sat:6,'일':0,'월':1,'화':2,'수':3,'목':4,'금':5,'토':6};

async function readJson(p, fallback) {
  try { return JSON.parse((await fs.readFile(p, 'utf8')).replace(/^﻿/, '')); }
  catch (e) { if (e.code === 'ENOENT') return fallback; throw e; }
}
async function writeJson(p, data) {
  await fs.mkdir(path.dirname(p), {recursive: true});
  const tmp = p + '.' + randomUUID();
  await fs.writeFile(tmp, JSON.stringify(data, null, 2));
  await fs.rename(tmp, p);
}

// 한국 시간 기준 구성요소
function kst(d = new Date()) {
  const k = new Date(d.getTime() + 9 * 3600e3);
  return {y: k.getUTCFullYear(), m: k.getUTCMonth(), d: k.getUTCDate(), h: k.getUTCHours(), min: k.getUTCMinutes(), dow: k.getUTCDay()};
}
function kstDate(y, m, d, h, min) { return new Date(Date.UTC(y, m, d, h, min) - 9 * 3600e3); }

// "지금부터 얼마 뒤"를 분 단위로 읽습니다. 예: "in 1", "in 90s", "in 2h", "after 5", "+5", "1분 뒤", "30초 후", "2시간 뒤"
function relativeMs(w) {
  let m;
  if ((m = w.match(/^(?:in|after|\+)\s*(\d+(?:\.\d+)?)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours)?$/))) {
    const unit = (m[2] || 'm')[0];
    return +m[1] * (unit === 's' ? 1e3 : unit === 'h' ? 3600e3 : 60e3);
  }
  if ((m = w.match(/^(\d+(?:\.\d+)?)\s*(초|분|시간)\s*(?:뒤|후|있다가|이따가?)(?:에)?$/))) return +m[1] * (m[2] === '초' ? 1e3 : m[2] === '시간' ? 3600e3 : 60e3);
  return null;
}
// 문장 안에서 "1분 뒤" 같은 표현을 찾아 when 형식으로 돌려줍니다(없으면 null). 모델이 시간을 문장에 섞어 보냈을 때 씁니다.
export function findWhen(text) {
  const m = String(text || '').match(/(\d+(?:\.\d+)?)\s*(초|분|시간)\s*(?:뒤|후|있다가|이따가?)/);
  return m ? 'in ' + m[1] + (m[2] === '초' ? 's' : m[2] === '시간' ? 'h' : 'm') : null;
}
// 단순 알림(알람·리마인더)인지: 모델을 다시 돌리지 않고 그 시간에 알림만 띄웁니다.
export function isAlarm(task) {
  if (task?.alarm === true) return true;
  if (task?.alarm === false) return false;
  const p = String(task?.prompt || '');
  if (/^알림\s*[:：]/.test(p)) return true;
  // 검색·요약처럼 실제로 할 일이 들어 있으면 알람이 아니라 작업입니다.
  if (p.length > 60 || /(검색|요약|정리|확인|찾아|읽어|보내|만들|작성|실행|내려받|다운|분석|저장|열어|조사|비교)/.test(p)) return false;
  return /(알람|리마인더|리마인드|깨워|(?:이라고|라고)\s*알려|알림\s*$)/.test(p);
}
// 알림 창에 보일 문장: "1분 뒤 알람 울려줘" → "알람 시간입니다", "약 먹기 알람" → "약 먹기"
export function alarmMessage(task) {
  const text = String(task?.prompt || '').replace(/^알림\s*[:：]\s*/, '')
    .replace(/(매일|매주|오전|오후|아침|저녁)?\s*\d+\s*(초|분|시간|시)\s*(뒤|후|있다가|이따가?|마다)?(에)?/g, ' ')
    .replace(/매일|매주/g, ' ')
    .replace(/(이라고|라고|를|을)?\s*(알람|알림|리마인더|리마인드)?\s*(울려|알려|해|맞춰|설정해)?\s*(줘|주세요|달라|울리기)?\s*[.!]*\s*$/, '')
    .replace(/["'‘’“”_]/g, ' ').replace(/\s+/g, ' ').trim();
  return /[가-힣a-z0-9]/i.test(text) ? text : '알람 시간입니다';
}

// when 형식: "in 1"(1분 뒤) | "in 2h" | "1분 뒤" | "once 15:30"(오늘, 지났으면 내일) | "once 2026-11-11 15:00" | "daily 09:00" | "weekly mon 09:00" | "every 30"(분)
export function parseWhen(when, now = new Date()) {
  const w = String(when || '').trim().toLowerCase();
  let m;
  const delay = relativeMs(w);
  if (delay !== null) {
    if (!(delay > 0) || delay > 366 * 864e5) throw Error('얼마 뒤인지는 1초 이상 1년 이내로 주세요.');
    return {type: 'once', at: new Date(now.getTime() + delay).toISOString()};
  }
  if ((m = w.match(/^(?:once\s+)?(\d{1,2}):(\d{2})$/)) && +m[1] < 24 && +m[2] < 60) {
    const k = kst(now);
    let t = kstDate(k.y, k.m, k.d, +m[1], +m[2]);
    if (t <= now) t = new Date(t.getTime() + 864e5);
    return {type: 'once', at: t.toISOString()};
  }
  if ((m = w.match(/^daily\s+(\d{1,2}):(\d{2})$/))) return {type: 'daily', h: +m[1], min: +m[2]};
  if ((m = w.match(/^weekly\s+(\S+)\s+(\d{1,2}):(\d{2})$/)) && m[1] in DAYS) return {type: 'weekly', dow: DAYS[m[1]], h: +m[2], min: +m[3]};
  if ((m = w.match(/^every\s+(\d+)$/))) { const n = +m[1]; if (n < 5) throw Error('반복 간격은 5분 이상이어야 합니다.'); return {type: 'every', minutes: n}; }
  if ((m = w.match(/^(?:once\s+)?(\d{4})-(\d{2})-(\d{2})[\st]+(\d{1,2}):(\d{2})$/))) return {type: 'once', at: kstDate(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).toISOString()};
  throw Error('시간 형식이 올바르지 않습니다. target에 다음 중 하나를 넣으세요: "in 1"(1분 뒤), "in 2h"(2시간 뒤), "once 15:30"(오늘 그 시각), "once 2026-11-11 15:00", "daily 09:00", "weekly mon 09:00", "every 30"(30분마다, 5분 이상)');
}

export function describe(s) {
  const pad = n => String(n).padStart(2, '0');
  if (s.type === 'daily') return '매일 ' + pad(s.h) + ':' + pad(s.min);
  if (s.type === 'weekly') return '매주 ' + '일월화수목금토'[s.dow] + '요일 ' + pad(s.h) + ':' + pad(s.min);
  if (s.type === 'every') return s.minutes + '분마다';
  if (s.type === 'once') { const k = kst(new Date(s.at)); return k.y + '-' + pad(k.m + 1) + '-' + pad(k.d) + ' ' + pad(k.h) + ':' + pad(k.min) + ' 한 번'; }
  return '?';
}

// 가장 최근에 실행됐어야 할 시각(지금 이전). 그 시각 이후 실행한 적이 없으면 실행 대상입니다.
function lastSlot(s, now) {
  const k = kst(now);
  if (s.type === 'daily') { let t = kstDate(k.y, k.m, k.d, s.h, s.min); if (t > now) t = new Date(t - 864e5); return t; }
  if (s.type === 'weekly') { let t = kstDate(k.y, k.m, k.d, s.h, s.min); t = new Date(t - ((k.dow - s.dow + 7) % 7) * 864e5); if (t > now) t = new Date(t - 7 * 864e5); return t; }
  if (s.type === 'once') { const t = new Date(s.at); return t <= now ? t : null; }
  return null;
}

export async function listTasks() { return readJson(tasksFile, []); }

export async function addTask({name, prompt, when}) {
  if (!String(prompt || '').trim()) throw Error('예약할 작업 내용(prompt)이 필요합니다.');
  const schedule = parseWhen(when);
  const tasks = await listTasks();
  if (tasks.length >= 50) throw Error('예약 작업은 50개까지 만들 수 있습니다.');
  const task = {id: randomUUID().slice(0, 8), name: String(name || prompt).slice(0, 40), prompt: String(prompt).slice(0, 2000), schedule, enabled: true, created: new Date().toISOString(), lastRun: null};
  task.alarm = isAlarm(task);
  // 같은 내용·같은 시각의 예약이 이미 켜져 있으면 새로 만들지 않습니다(알람이 여러 번 울리는 것 방지).
  const same = tasks.find(t => t.enabled && t.prompt === task.prompt && JSON.stringify(t.schedule.type === 'once' ? {...t.schedule, at: String(t.schedule.at).slice(0, 16)} : t.schedule) === JSON.stringify(schedule.type === 'once' ? {...schedule, at: schedule.at.slice(0, 16)} : schedule));
  if (same) return {...same, duplicate: true};
  // 처음 만든 순간 이전의 시각은 실행하지 않도록 기준을 지금으로 둡니다.
  if (schedule.type !== 'once') task.lastRun = new Date().toISOString();
  tasks.push(task);
  await writeJson(tasksFile, tasks);
  return task;
}

export async function removeTask(key) {
  const tasks = await listTasks();
  const k = String(key || '').trim();
  const left = tasks.filter(t => t.id !== k && t.name !== k);
  if (left.length === tasks.length) throw Error('해당 예약 작업이 없습니다: ' + k);
  await writeJson(tasksFile, left);
  return tasks.length - left.length;
}

export async function dueTasks(now = new Date()) {
  const due = [];
  for (const t of await listTasks()) {
    if (!t.enabled) continue;
    const last = t.lastRun ? new Date(t.lastRun) : null;
    if (t.schedule.type === 'every') { if (!last || now - last >= t.schedule.minutes * 60e3) due.push(t); continue; }
    const slot = lastSlot(t.schedule, now);
    // 너무 오래 지난 시각(앱이 꺼져 있던 동안)은 6시간 이내만 따라잡습니다.
    if (slot && (!last || last < slot) && now - slot < 6 * 3600e3) due.push(t);
  }
  return due;
}

export async function markRun(id, result) {
  const tasks = await listTasks();
  const t = tasks.find(x => x.id === id);
  if (!t) return;
  t.lastRun = new Date().toISOString();
  t.lastResult = String(result || '').slice(0, 300);
  if (t.schedule.type === 'once') t.enabled = false;
  await writeJson(tasksFile, tasks);
}

export async function getState() { return readJson(stateFile, {}); }
export async function setState(patch) { const s = {...await getState(), ...patch}; await writeJson(stateFile, s); return s; }
export {today};
