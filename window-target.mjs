// Shared desktop target resolution. Never choose the first of several matching windows.
const clean=value=>String(value??'').normalize('NFKC').replace(/\s+/g,'').toLowerCase();
const processName=value=>clean(value).replace(/\.exe$/,'');
export function windowCandidates(windows,hint,{request=false}={}){
  const rows=(Array.isArray(windows)?windows:[]).filter(w=>w?.handle && w.pid && w.title && !/로컬 Gemma/i.test(w.title));
  const text=clean(hint);
  if(!text)return [];
  const handle=text.match(/^(?:hwnd:)?([1-9]\d*)$/i);
  if(handle)return rows.filter(w=>String(w.handle)===handle[1]);
  // An explicit stale/malformed handle must not fall back to another app.
  if(text.startsWith('hwnd:'))return [];
  const pid=text.match(/^pid:([1-9]\d*)$/i);
  if(pid)return rows.filter(w=>String(w.pid)===pid[1]);
  if(text.startsWith('pid:'))return [];
  const exact=rows.filter(w=>clean(w.title)===text || processName(w.process)===processName(hint));
  if(exact.length)return exact;
  if(!request)return rows.filter(w=>clean(w.title).includes(text) || processName(w.process).includes(processName(hint)));
  return rows.filter(w=>[w.title,...String(w.title).split(/\s+[-–—|]\s+/),w.process]
    .some(part=>clean(part).length>=3 && text.includes(clean(part))));
}

export function normalizeWindowAction(action){
  if(action?.tool!=='windows')return action;
  const target=String(action.window||action.text||'').trim();
  if(!target)return action;
  return {...action,tool:'focus',text:/^\d+$/.test(target)?'HWND:'+target:target,path:''};
}

// Summarize only input capabilities. Do not send arbitrary focus properties,
// control text/Name/Value, or runtime identifiers into model prompts.
export function focusSummary(frame){
  const focus=frame?.focus;
  if(!focus||typeof focus!=='object')return '';
  if(focus.available===false)return 'Focused input: unavailable';
  const label=value=>String(value??'').replace(/[\r\n\t]/g,' ').slice(0,80);
  const flag=value=>typeof value==='boolean'?value:null;
  const pid=Number(frame?.window?.pid),windowPid=Number(focus.pid),inputPid=Number(focus.focusPid);
  return 'Focused input: '+JSON.stringify({role:label(focus.role),class:label(focus.class),editable:flag(focus.editable),readOnly:flag(focus.readOnly),valuePattern:flag(focus.valuePattern),pidMatches:pid>0&&windowPid>0&&inputPid>0?pid===windowPid&&pid===inputPid:null});
}
