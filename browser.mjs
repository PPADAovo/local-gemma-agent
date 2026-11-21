// 브라우저 조작: 에이전트 전용 Chrome/Edge 창을 Chrome DevTools Protocol(CDP)로 직접 다룹니다.
// 화면 좌표를 찍는 방식이 아니라 페이지의 버튼·입력칸 목록을 읽고 누르기 때문에 웹에서 훨씬 정확합니다.
// 사용자의 평소 브라우저 프로필(로그인·쿠키)과 분리된 별도 프로필을 씁니다.
import {appDataDir} from './app-data.mjs';
import {withControlNotice} from './control-notice.mjs';
import {connectWorkTab} from './work-tab-client.mjs';
import {fork,spawn} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {startPreview} from './preview-server.mjs';
import {browserTaskLabel} from './browser-task-label.mjs';


function checkBrowserPermission(brand=process.env.GEMMA_BROWSER_BRAND==='edge'?'msedge':'chrome'){
  if(!process.env.LOCALAPPDATA)return;
  const file=path.join(appDataDir(),'preferences.json');
  if(!fs.existsSync(file))return;
  const settings=JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
  if(settings.computerUse===false || settings.disabledApps?.includes(brand))throw Error('설정에서 브라우저 제어가 꺼져 있습니다: '+brand);
}
const previewRenderer=new URL(import.meta.url).searchParams.has('preview');
let renderer,previewActive=false;
let activeBrand;
let base=!previewRenderer && process.env.AGENT_BROWSER_PORT?'http://127.0.0.1:'+Number(process.env.AGENT_BROWSER_PORT):'';
let owner, starting, borrowedTab, bridge, bridgeAttempt, leaveOpen=false;
let label=browserTaskLabel(),navigated=false;
let browserRequest='';
export function setBrowserTask(request){browserRequest=String(request||'');label=browserTaskLabel(request);}
export async function hasWorkTab(){
  if(previewRenderer)return false;
  checkBrowserPermission();
  if(bridge)return true;
  if(!bridgeAttempt)bridgeAttempt=(async()=>{
    bridge=await connectWorkTab();
    if(bridge || process.platform!=='win32' || !process.env.GEMMA_INBOX ||
       process.env.AGENT_BROWSER_PORT || process.env.GEMMA_BROWSER_BRAND==='edge')return Boolean(bridge);
    const exe=findBrowser();
    if(!exe || path.basename(exe).toLowerCase()!=='chrome.exe')return false;
    const stateFile=path.join(process.env.LOCALAPPDATA,'Google','Chrome','User Data','Local State');
    const profile=JSON.parse(fs.readFileSync(stateFile,'utf8')).profile?.last_used;
    if(!profile || path.basename(profile)!==profile)throw Error('Chrome 프로필을 확인하지 못했습니다.');
    const child=spawn(exe,['--profile-directory='+profile,'--no-startup-window'],{detached:true,stdio:'ignore'});
    await new Promise((ok,fail)=>{child.once('spawn',ok);child.once('error',fail);});
    child.unref();
    for(let attempt=0;attempt<24;attempt++){
      await pause(500);
      bridge=await connectWorkTab();
      if(bridge)return true;
    }
    throw Error('Chrome 작업 탭 확장 연결을 확인해 주세요.');
  })().finally(()=>{bridgeAttempt=null;});
  return bridgeAttempt;
}
export async function pauseWorkTab(paused){if(bridge)await bridge.call(paused?'suspend':'resume');}
export async function leaveWorkTabOpen(){if(bridge)await bridge.call('keep');else if(owner?.connected){await new Promise((ok,fail)=>owner.send({keep:true},e=>e?fail(e):ok()));leaveOpen=true;}}
export async function useConnectedMail(){
  checkBrowserPermission("chrome");
  if(base || starting || await hasWorkTab())return;
  const legacy='http://127.0.0.1:9333';
  const pages=await fetch(legacy+'/json/list',{signal:AbortSignal.timeout(600)})
    .then(r=>r.json()).catch(()=>[]);
  const mail=Array.isArray(pages)&&pages.find(t=>t.type==='page' && /^https:\/\/mail\.google\.com\/mail\/u\/\d+\//.test(t.url));
  if(!mail)return;
  const session=await connect(mail);
  try{
    const {targetId}=await session.send('Target.createTarget',{url:'about:blank',background:true});
    borrowedTab=currentPageId=targetId;base=legacy;
    const page=await pageTarget('browser_read');
    const tab=await connect(page);
    try{await tab.send('Page.navigate',{url:new URL(mail.url).origin+new URL(mail.url).pathname});await waitLoad(tab,true);}
    finally{tab.close();}
  }finally{session.close();}
}
export function browserPageId(){return previewActive?renderer.browserPageId():currentPageId;}
export function browserEndpoint(){return previewActive?renderer.browserEndpoint():base;}
export async function closeBrowser(){
  if(renderer){await renderer.closeBrowser();renderer=null;previewActive=false;}
  previewServer?.close();previewServer=undefined;previewFilePath=undefined;
  if(bridge){try{await bridge.call('release');}finally{bridge.close();bridge=null;bridgeAttempt=null;currentPageId=undefined;navigated=false;leaveOpen=false;}return;}
  if(borrowedTab){
    try{await fetch(base+'/json/close/'+borrowedTab,{signal:AbortSignal.timeout(2000)});}
    finally{borrowedTab=null;currentPageId=undefined;base='';}
  }
  if(!owner)return;
  const child=owner;
  if(child.exitCode===null && child.signalCode===null){
    const exited=new Promise(resolve=>child.once('exit',resolve));
    if(leaveOpen && child.connected)await new Promise(resolve=>{
      const done=()=>{clearTimeout(timer);child.off('message',message);child.off('exit',done);resolve();};
      const message=m=>{if(m?.groupsEnded)done();};
      const timer=setTimeout(done,5000);
      child.on('message',message);child.once('exit',done);child.send({endGroups:true},error=>{if(error)done();});
    });
    if(child.connected)child.disconnect();
    if(!leaveOpen)await exited;else child.unref();
  }
  owner=null; starting=null; currentPageId=undefined; base='';leaveOpen=false;navigated=false;
}

function findBrowser(){
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const local = process.env.LOCALAPPDATA || '';
  const candidates = [
    process.env.AGENT_BROWSER_PATH,
    path.join(pf,'Google','Chrome','Application','chrome.exe'),
    path.join(pf86,'Google','Chrome','Application','chrome.exe'),
    path.join(local,'Google','Chrome','Application','chrome.exe'),
    path.join(pf86,'Microsoft','Edge','Application','msedge.exe'),
    path.join(pf,'Microsoft','Edge','Application','msedge.exe'),
    '/usr/bin/chromium','/usr/bin/chromium-browser','/usr/bin/google-chrome'
  ].filter(Boolean);
  const requested=process.env.GEMMA_BROWSER_BRAND;
  return candidates.filter(p=>!requested || path.basename(p).toLowerCase()===(requested==='edge'?'msedge.exe':'chrome.exe')).find(p=>{try{return fs.statSync(p).isFile();}catch{return false;}});
}

async function json(url,method='GET'){
  const r=await fetch(base+url,{method,signal:AbortSignal.timeout(4000)});
  if(!r.ok)throw Error('브라우저 응답 오류 '+r.status);
  return r.json();
}

async function ensureBrowser(){
  if(await hasWorkTab()){if(!currentPageId){const target=await bridge.call('create',{label,downloadPath:process.env.USERPROFILE?path.join(process.env.USERPROFILE,'Downloads'):undefined});currentPageId=target.id;process.stderr.write('@worktab '+target.ticket+' '+(process.env.GEMMA_BROWSER_BRAND||'chrome')+'\n');}return;}
  if(base)return;
  if(!starting)starting=new Promise((resolve,reject)=>{
    const exe=findBrowser();
    if(!exe){reject(Error('Chrome 또는 Edge를 찾지 못했습니다.'));return;}
    activeBrand=path.basename(exe).toLowerCase()==="msedge.exe"?"msedge":"chrome";
    checkBrowserPermission(activeBrand);
    owner=fork(new URL('./browser-owner.mjs',import.meta.url),[exe,JSON.stringify(label)],{env:previewRenderer?{...process.env,GEMMA_VISIBLE_BROWSER:'0'}:process.env,detached:true,execArgv:[],stdio:['ignore','ignore','ignore','ipc'],windowsHide:true});
    owner.once('error',reject);
    owner.once('exit',()=>reject(Error('작업 브라우저가 종료되었습니다.')));
    owner.once('message',message=>{
      if(message.error){reject(Error(message.error));return;}
      if(message.groupError)process.stderr.write('@progress '+JSON.stringify('작업 탭 그룹을 표시하지 못했습니다: '+message.groupError)+'\n');
      base='http://127.0.0.1:'+message.port;
      if(message.visible){
        createWorkWindow().then(()=>{if(process.env.GEMMA_INBOX)process.stderr.write('@browserpid '+message.pid+'\n');resolve();},reject);
        return;
      }
      resolve();
    });
  });
  await starting;
}

let currentPageId,previewServer,previewFilePath;

async function createWorkWindow(){
  const version=await json('/json/version');
  const session=await connect(version,false);
  try{
    const {targetId}=await session.send('Target.createTarget',{url:'about:blank',newWindow:true,background:false,windowState:'normal'});
    currentPageId=targetId;
    const {windowId}=await session.send('Browser.getWindowForTarget',{targetId});
    await session.send('Browser.setWindowBounds',{windowId,bounds:{windowState:'minimized'}});
  }finally{session.close();}
}

async function listPages(){
  if(bridge)return bridge.call('list');
  return (await json('/json/list')).filter(t=>t.type==='page' && t.webSocketDebuggerUrl);
}

async function pageTarget(tool){
  await ensureBrowser();
  const list=await listPages();
  const current=list.find(page=>page.id===currentPageId);
  if(current)return current;
  if(currentPageId && !['browser_open','browser_read'].includes(tool))
    throw Error('직전에 읽은 탭이 닫혔습니다. browser_read로 대상 페이지를 다시 확인하세요.');
  const selected=list[0];
  if(!selected)throw Error('열려 있는 작업 페이지가 없습니다. 먼저 주소를 여세요.');
  currentPageId=selected.id;
  return selected;
}

class Session{
  constructor(ws){this.ws=ws;this.id=0;this.pending=new Map();
    ws.addEventListener('message',e=>{
      const m=JSON.parse(typeof e.data==='string'?e.data:Buffer.from(e.data).toString());
      const reply=this.pending.get(m.id);
      if(!reply)return;
      this.pending.delete(m.id);clearTimeout(reply.timer);
      m.error?reply.rej(Error(m.error.message)):reply.res(m.result);
    });
    ws.addEventListener('close',()=>{
      for(const reply of this.pending.values()){clearTimeout(reply.timer);reply.rej(Error('대상 탭 연결이 끊어졌습니다.'));}
      this.pending.clear();
    });
  }
  send(method,params={}){
    const id=++this.id;
    return new Promise((res,rej)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);rej(Error('브라우저 명령 시간 초과: '+method));},20000);
      this.pending.set(id,{res,rej,timer});
      try{this.ws.send(JSON.stringify({id,method,params}));}
      catch(error){this.pending.delete(id);clearTimeout(timer);rej(error);}
    });
  }
  close(){try{this.ws.close();}catch{}}
}

async function connect(t,enableRuntime=true){
  if(t.workTab)return {send:(method,params={})=>bridge.call('command',{id:t.id,method,params}),close(){}};
  if(typeof WebSocket==='undefined')throw Error('이 Node.js 버전은 브라우저 조작을 지원하지 않습니다. Node.js 22 이상으로 업데이트하세요.');
  const ws=new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',()=>rej(Error('브라우저 연결 실패')),{once:true});});
  const s=new Session(ws);
  try{if(enableRuntime)await s.send('Runtime.enable');}catch(error){s.close();throw error;}
  return s;
}

async function evaluate(s,expression){
  const r=await s.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  if(r.exceptionDetails)throw Error('페이지 스크립트 오류: '+(r.exceptionDetails.exception?.description||r.exceptionDetails.text));
  return r.result.value;
}

async function waitLoad(s,waitForNavigation=false){
  let previous, stable=0;
  for(let i=0;i<40;i++){
    try{
      if(await evaluate(s,'document.readyState')==='complete' &&
         (!waitForNavigation || await evaluate(s,'location.href')!=='about:blank')){
        const state=await evaluate(s,PAGE_STATE);
        stable=state===previous ? stable+1 : 0;
        previous=state;
        if(stable>=4)break;
      }else{stable=0;previous=undefined;}
    }catch{}
    await new Promise(r=>setTimeout(r,250));
  }
}

// 페이지의 클릭·입력 가능한 요소에 번호(B1, B2…)를 붙이고 목록과 본문을 돌려줍니다.
// 옛 포털처럼 <frameset>/<iframe> 안에 실제 내용이 있는 페이지가 많습니다. 최상위 문서만 보면 빈 화면으로 읽힙니다.
// 같은 출처의 frame·iframe 문서까지 돌고(다른 출처는 브라우저가 막음), 클릭 좌표에는 frame 위치를 더합니다.
// 최신 웹 앱(웹 컴포넌트)은 버튼·입력칸을 열린 Shadow DOM 안에 둡니다. 문서마다 shadow root도 같은 좌표계의 문서로 함께 돕니다(문서당 요소 2만 개까지).
const FRAMES=`const __docs=(d=document,ox=0,oy=0,out=[])=>{const local=[d];let seen=0;const shadows=root=>{for(const el of root.querySelectorAll('*')){if(++seen>20000)return;if(el.shadowRoot){local.push(el.shadowRoot);shadows(el.shadowRoot);}}};shadows(d);for(const root of local)out.push({d:root,ox,oy});for(const root of local)for(const f of root.querySelectorAll('iframe,frame')){try{const cd=f.contentDocument;if(!cd||!cd.documentElement)continue;const r=f.getBoundingClientRect();__docs(cd,ox+r.left+f.clientLeft,oy+r.top+f.clientTop,out);}catch{}}return out;};const __find=id=>{for(const x of __docs()){const el=x.d.querySelector('[data-agent-id="'+id+'"]');if(el)return {el,ox:x.ox,oy:x.oy};}return null;};`;
const SNAPSHOT=`(()=>{${FRAMES}
  const W=el=>el.ownerDocument.defaultView||window;
  __docs().forEach(({d})=>d.querySelectorAll('[data-agent-id]').forEach(e=>e.removeAttribute('data-agent-id')));
  const sel='a[href],button,input:not([type=hidden]),textarea,select,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=switch],[role=radio],[role=option],[role=textbox],[contenteditable=true],[onclick],summary';
  const out=[];let n=0;
  const controls=__docs().flatMap(({d})=>[...d.querySelectorAll(sel)]);
  const inView=el=>{const r=el.getBoundingClientRect();return r.bottom>0 && r.top<W(el).innerHeight;};
  for(const el of [...controls.filter(inView),...controls.filter(el=>!inView(el))]){
    const r=el.getBoundingClientRect();const st=W(el).getComputedStyle(el);const innerHeight=W(el).innerHeight,innerWidth=W(el).innerWidth;
    if(r.width<2||r.height<2||st.visibility==='hidden'||st.display==='none'||st.pointerEvents==='none'||
       el.closest('[inert],[aria-hidden=true]')||el.matches(':disabled,[aria-disabled=true]'))continue;
    // Responsive layouts can keep desktop and mobile inputs overlaid. Report the
    // control which actually receives a click at the visible part of its box.
    const visible=r.bottom>0 && r.right>0 && r.top<innerHeight && r.left<innerWidth;
    if(visible){
      const cx=(Math.max(0,r.left)+Math.min(innerWidth,r.right))/2;
      const cy=(Math.max(0,r.top)+Math.min(innerHeight,r.bottom))/2;
      // Shadow DOM 안의 입력칸은 문서 기준으로는 바깥 host가 맞으므로, 그 shadow root 기준으로 확인합니다.
      const scope=el.getRootNode();
      const hit=(scope&&typeof scope.elementFromPoint==='function'?scope:el.ownerDocument).elementFromPoint(cx,cy);
      // Some stretched card links intentionally overlay the card through a
      // sibling. Apply the hit test only to text inputs.
      if(el.matches('input:not([type=checkbox]):not([type=radio]),textarea') && (!hit||!el.contains(hit)))continue;
    }
    if(n>=120)break;
    const id='B'+(++n);el.setAttribute('data-agent-id',id);
    const labelledBy=(el.getAttribute('aria-labelledby')||'').split(/\\s+/).filter(Boolean)
      .map(id=>el.ownerDocument.getElementById(id)?.textContent||'').join(' ').trim();
    let destination='';
    if(el.tagName==='A'){
      try{
        const link=new URL(el.href);
        if(['https:','http:'].includes(link.protocol)) destination=link.hostname+link.pathname;
      }catch{}
    }
    const label=(el.getAttribute('aria-label')||labelledBy||el.innerText?.trim()||(el.type==='password'||el.autocomplete==='one-time-code'?'':el.value)||el.placeholder||el.title||el.alt||el.name||el.querySelector('img[alt]')?.alt||'').replace(/\\s+/g,' ').trim().slice(0,60);
    const kind=el.tagName.toLowerCase()+(el.type&&el.tagName==='INPUT'?':'+el.type:'');
    const states=[];
    for(const [attr,on,off] of [['aria-pressed','켜짐','꺼짐'],['aria-checked','체크됨','체크 안 됨'],['aria-selected','선택됨','선택 안 됨'],['aria-expanded','펼쳐짐','접힘']]){
      const value=el.getAttribute(attr);
      if(['true','false','mixed'].includes(value))states.push(value==='true'?on:value==='false'?off:'부분 선택');
    }
    if(el.matches('input[type=checkbox],input[type=radio]')&&!el.hasAttribute('aria-checked'))
      states.push(el.indeterminate?'부분 선택':el.checked?'체크됨':'체크 안 됨');
    out.push(id+' ['+kind+'] '+states.map(state=>'['+state+'] ').join('')+(el.autocomplete==='one-time-code'?'[one-time-code] ':'')+(label||destination.slice(0,160))+(r.top>innerHeight||r.bottom<0?' (화면 밖)':''));
  }
  const text=__docs().map(({d})=>d.body?d.body.innerText:'').filter(Boolean).join('\\n').replace(/\\n{3,}/g,'\\n\\n').slice(0,6000);
  const rows=[...document.querySelectorAll('ytd-channel-renderer')].filter(inView).map(row=>row.querySelector('#channel-title,#text')?.textContent?.trim()).filter(Boolean);
  const root=document.scrollingElement;
  const position=root?'스크롤 '+Math.round(root.scrollTop)+' / '+Math.max(0,root.scrollHeight-root.clientHeight):'';
  return {url:location.href,title:document.title,elements:out,text:[position,...rows,text].join('\\n')};
})()`;


// SPA 검색에서는 document.readyState가 항상 complete다. 주소, 본문 또는
// 화면의 컨트롤이 바뀐 뒤 안정될 때까지 관찰하되 같은 키/클릭을 재전송하지 않는다.
const PAGE_STATE=`(()=>[location.href, document.title,
  (document.body?.innerText || '').slice(0,9000),
  document.querySelectorAll('a[href],button,[role=option]').length].join('\\n'))()`;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function childPages(session,id){
  try{
    const {targetInfos}=await session.send('Target.getTargets');
    return targetInfos.filter(t=>t.type==='page' && t.openerId===id).map(t=>t.targetId);
  }catch{return [];}
}

// 페이지를 열자마자 사이트가 스스로 띄운 팝업(공지·이벤트 창)은 작업을 가리고 에이전트가 다룰 수 없으므로 닫습니다.
// 사용자가 시킨 클릭으로 열린 새 탭·팝업(로그인 창 등)은 afterInput이 따라가므로 여기서 닫지 않습니다.
async function closeAutoPopups(session,pageId,oldChildren){
  await pause(700); // onload에서 window.open하는 팝업이 뜰 시간
  const added=(await childPages(session,pageId)).filter(id=>!oldChildren.includes(id));
  let closed=0;
  for(const targetId of added){
    try{await session.send('Target.closeTarget',{targetId});closed++;}catch{}
  }
  return closed;
}

async function afterInput(session,page,before,oldChildren){
  let previous=before, settled=0, changed=false;
  for(let i=0;i<14;i++){
    await pause(225);
    const children=await childPages(session,page.id);
    const added=children.filter(id=>!oldChildren.includes(id));
    if(added.length===1){
      const next=(await listPages()).find(p=>p.id===added[0]);
      if(next){
        const child=await connect(next);
        let snap=null;
        try{
          await waitLoad(child,true);
          snap=await evaluate(child,SNAPSHOT);
        }catch{/* 다운로드용 새 탭은 곧바로 닫힙니다. */}finally{child.close();}
        // 웹 페이지가 아닌 새 탭(about:blank — 대부분 파일 다운로드)으로는 옮겨 가지 않습니다.
        // 옮겨 가면 그 탭이 닫힌 뒤 모든 조작이 "작업 탭 범위를 벗어났습니다"로 실패했습니다.
        if(snap && /^https?:\/\//i.test(snap.url)){
          currentPageId=next.id;
          return '이 동작으로 열린 새 탭\n'+format(snap);
        }
        const here=await evaluate(session,SNAPSHOT);
        return '이 동작으로 파일 다운로드가 시작된 것 같습니다(빈 새 탭). 다운로드 폴더('+(process.env.USERPROFILE?path.join(process.env.USERPROFILE,'Downloads'):'Downloads')+')에서 .tmp/.crdownload가 사라지고 파일이 생겼는지 확인하세요.\n'+format(here);
      }
    }
    let now;
    try{now=await evaluate(session,PAGE_STATE);}catch{continue;}
    changed=now!==before;
    settled=changed && now===previous ? settled+1 : 0;
    previous=now;
    if(settled>=4)break;
  }
  const snap=await evaluate(session,SNAPSHOT);
  return (changed?'':'주소와 본문에서 변화를 확인하지 못했습니다. 같은 조작을 반복하기 전에 아래 요소와 안내를 확인하세요.\n')+format(snap);
}

async function inputIdError(session){
  const snap=await evaluate(session,SNAPSHOT);
  const inputs=snap.elements.filter(line=>/\[(?:input(?::[^\]]+)?|textarea)\]/i.test(line)).slice(0,8);
  return Error('이 웹페이지에서는 B번호를 사용하세요. 현재 입력칸: '+(inputs.join(' / ')||'없음. browser_read로 페이지를 확인하세요.'));
}

function format(snap){
  return '페이지: '+snap.title+'\n주소: '+snap.url+'\n\n누를 수 있는 요소 (text에 B번호):\n'+(snap.elements.join('\n')||'(없음)')+'\n\n본문 일부:\n'+snap.text;
}

export function browser(action,previewFile,structured=false){
  return withControlNotice(()=>runBrowser(action,previewFile,structured));
}
async function runBrowser(action,previewFile,structured){
  let destination;
  if(action.tool==='browser_type' || action.tool==='browser_click'){
    const raw=action.tool==='browser_type'?(action.target||action.path):(action.target||action.text);
    const id=/^#?(B\d+)$/i.exec(String(raw||'').trim());
    if(id)action={...action,target:id[1].toUpperCase()};
  }
  if(action.tool==='browser_open'){
    const value=String(action.text||'').trim();
    if(!value || /^(?!https?:)[a-z][a-z0-9+.-]*:\/\/|^(?:about|javascript|data|file):/i.test(value))
      throw Error('http(s) 주소를 입력하세요.');
    try{destination=new URL(/^https?:\/\//i.test(value)?value:'https://'+value);}catch{throw Error('올바른 웹 주소를 입력하세요.');}
    if(!['http:','https:'].includes(destination.protocol)||destination.username||destination.password)throw Error('http(s) 주소만 열 수 있습니다.');
  }
  if(!previewRenderer){
    if(action.tool==='browser_open')previewActive=false;
    if(action.tool==='browser_preview'){
      renderer??=await import(new URL('./browser.mjs?preview',import.meta.url));
      previewActive=true;
    }
    if(previewActive)return renderer.browser(action,previewFile,structured);
  }
  checkBrowserPermission(activeBrand);
  if(!destination && action.tool!=='browser_preview' && !currentPageId && !base)
    throw Object.assign(Error('작업 페이지가 아직 열리지 않았습니다.'),{code:'NO_WORK_PAGE'});
  if(action.tool==='browser_preview' && (!previewFile || !path.isAbsolute(previewFile)))throw Error('검증된 미리보기 경로가 필요합니다.');
  let s;
  try{
    const page=await pageTarget(action.tool);
    s=await connect(page);
    const tool=action.tool;
    if(tool==='browser_preview'){
      if(!previewFile || !path.isAbsolute(previewFile))throw Error('검증된 미리보기 경로가 필요합니다.');
      if(previewFile!==previewFilePath || !previewServer){
        const next=await startPreview(previewFile);
        previewServer?.close();previewServer=next;previewFilePath=previewFile;
      }
      const url=previewServer.url;
      const nav=await s.send('Page.navigate',{url});
      if(nav.errorText)throw Error('미리보기 실패: '+nav.errorText);
      await waitLoad(s);
      const snap=await evaluate(s,SNAPSHOT);
      if(snap.url!==url)throw Error('선택한 HTML의 표시를 확인하지 못했습니다.');

      const layout='({width:document.documentElement.clientWidth, content:Math.max(document.documentElement.scrollWidth,document.body?.scrollWidth||0)})';
      const desktop=await evaluate(s,layout);
      let mobile;
      try{
        await s.send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
        mobile=await evaluate(s,layout);
      }finally{await s.send('Emulation.clearDeviceMetricsOverride');}
      const background=await evaluate(s,`(()=>{
        const style=document.getElementById('local-gemma-photo-background');
        if(!style)return null;
        const selector=style.sheet?.cssRules[0]?.selectorText;
        const el=selector && document.querySelector(selector);
        if(!el)return {selector,visible:false,loaded:false};
        const box=el.getBoundingClientRect(),css=getComputedStyle(el);
        const src=css.backgroundImage.match(/^url\\(["']?(.*?)["']?\\)$/)?.[1];
        return {selector,src,visible:box.width>0 && box.height>0 && css.visibility!=='hidden' && css.display!=='none'};
      })()`);
      if(background?.visible && background.src && background.src.startsWith(new URL('.',url).href)){
        const {createHash}=await import('node:crypto');
        const asset=await fetch(background.src,{redirect:'error',signal:AbortSignal.timeout(5000)});
        background.loaded=asset.ok;
        if(asset.ok)background.assetHash=createHash('sha256').update(Buffer.from(await asset.arrayBuffer())).digest('hex');
        const {PNG}=await import('./라이브러리/pngjs/lib/png.js');
        const frame=async()=>PNG.sync.read(Buffer.from((await s.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false})).data,'base64'));
        const normal=await frame();
        let hidden;
        try{
          await evaluate(s,"document.getElementById('local-gemma-photo-background').sheet.disabled=true");
          hidden=await frame();
        }finally{await evaluate(s,"document.getElementById('local-gemma-photo-background').sheet.disabled=false");}
        const restored=await frame();
        let changed=0;
        if([hidden,restored].every(f=>f.width===normal.width && f.height===normal.height)){
          const stride=Math.max(1,Math.ceil(normal.width/480));
          for(let y=0;y<normal.height;y+=stride)for(let x=0;x<normal.width;x+=stride){
            const i=4*(y*normal.width+x);
            if([0,1,2].some(k=>Math.abs(normal.data[i+k]-hidden.data[i+k])>8) &&
               [0,1,2].every(k=>Math.abs(normal.data[i+k]-restored.data[i+k])<4))changed++;
          }
        }
        background.visibleSamples=changed;
        delete background.src;
      }
      const report=format(snap)+'\n레이아웃 실측: 현재 창 '+desktop.width+'px / 콘텐츠 '+desktop.content+'px, 모바일 390px / 콘텐츠 '+mobile.content+'px'+(background?'\n적용한 사진 배경 실측: '+JSON.stringify(background):'');
      return structured?{report,background}:report;
    }
    if(tool==='browser_open'){
      if(await evaluate(s,'location.href')===destination.href)return format(await evaluate(s,SNAPSHOT));
      const history=navigated && (owner||bridge)?await s.send('Page.getNavigationHistory').catch(()=>null):null;
      try{
        const oldChildren=await childPages(s,page.id);
        const nav=await s.send('Page.navigate',{url:destination.href});
        if(nav.errorText)throw Error('페이지를 열지 못했습니다: '+nav.errorText);
        await waitLoad(s,true);
        const snap=await evaluate(s,SNAPSHOT);
        if(!/^https?:\/\//i.test(snap.url))throw Error('요청한 웹 페이지를 표시하지 못했습니다.');
        navigated=true;
        const closed=await closeAutoPopups(s,page.id,oldChildren);
        return format(snap)+(closed?'\n이 페이지가 열자마자 띄운 팝업 창 '+closed+'개(공지 등)를 닫았습니다. 필요하면 해당 링크를 browser_click으로 다시 여세요.':'');
      }catch(error){
        const previous=history?.entries?.[history.currentIndex];
        if(previous && /^https?:\/\//i.test(previous.url)){
          // A navigation error is reported before Chrome commits its error document.
          // Wait for that commit; going back too early is overwritten by it.
          for(let i=0;i<20;i++){
            const url=await evaluate(s,'location.href').catch(()=>'');
            if(url && url!==previous.url)break;
            await pause(50);
          }
          await s.send('Page.navigateToHistoryEntry',{entryId:previous.id}).catch(()=>{});
        }
        throw error;
      }
    }
    if(tool==='browser_visual_snapshot'){
      if(!previewFile || previewFile!==previewFilePath || !previewServer)throw Error('검증 대상 HTML 미리보기를 먼저 여세요.');
      const url=previewServer.url,frames=[];
      if(await evaluate(s,'location.href')!==url)throw Error('검증 대상 페이지가 다릅니다.');
      try{
        await s.send('Network.enable');
        await s.send('Network.setCacheDisabled',{cacheDisabled:true});
        for(const [width,height] of [[1280,800],[390,844]]){
          await s.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
          const nav=await s.send('Page.navigate',{url});
          if(nav.errorText)throw Error(nav.errorText);
          await waitLoad(s);
          await evaluate(s,'document.fonts.ready.then(()=>true)');
          await pause(200);
          const metrics=await evaluate(s,`(()=>{
            const nodes=[...document.querySelectorAll('svg,input,button,img')];
            return {overflow:Math.max(0,document.documentElement.scrollWidth-innerWidth),
              brokenImages:[...document.images].filter(i=>!i.complete||i.naturalWidth===0).length,
              elements:nodes.slice(0,300).map((e,i)=>{const r=e.getBoundingClientRect();return {key:e.id||e.tagName+':'+(e.getAttribute('class')||'')+':'+i,tag:e.tagName.toLowerCase(),width:r.width,height:r.height,x:r.x,y:r.y,right:r.right,bottom:r.bottom,horizontallyClipped:r.x<0||r.right>innerWidth};})};
          })()`);
          const pageHeight=await evaluate(s,'Math.max(innerHeight,document.documentElement.scrollHeight,document.body?.scrollHeight||0)');
          const captureHeight=Math.min(pageHeight,5000);
          const {data}=await s.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width,height:captureHeight,scale:1}});
          if(await evaluate(s,'location.href')!==url)throw Error('검증 도중 페이지가 바뀌었습니다.');
          frames.push({width,height,image:data,truncated:pageHeight>captureHeight,...metrics});
        }
      }finally{
        await s.send('Emulation.clearDeviceMetricsOverride');
        await s.send('Network.setCacheDisabled',{cacheDisabled:false});
      }
      return {file:previewFile,frames};
    }
    if(tool==='browser_capture'){
      const url=await evaluate(s,'location.href');
      if(!/^https?:\/\//i.test(url))throw Error('캡처할 웹페이지를 먼저 열어 주세요.');
      const {data}=await s.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
      if(await evaluate(s,'location.href')!==url)throw Error('캡처 중 페이지가 바뀌었습니다. 페이지를 다시 확인하세요.');
      return Buffer.from(data,'base64');
    }
    if(tool==='browser_read'){return format(await evaluate(s,SNAPSHOT));}
    if(tool==='browser_back'){await evaluate(s,'history.back()');await waitLoad(s);return format(await evaluate(s,SNAPSHOT));}
    if(tool==='browser_scroll'){
      const dir=String(action.text||'down').toLowerCase();
      await evaluate(s,'window.scrollBy(0,'+(dir==='up'?-1:1)+'*innerHeight*0.8)');
      await new Promise(r=>setTimeout(r,300));
      return format(await evaluate(s,SNAPSHOT));
    }
    const id=String(action.target||action.text||'').trim().toUpperCase().match(/^B\d+$/)?.[0];
    if(tool==='browser_click'){
      if(!id)throw Error('text에 B번호(예: B3)를 넣으세요.');
      const box=await evaluate(s,`(()=>{${FRAMES}const f=__find('${id}');if(!f)return null;const el=f.el;el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();const g=__find('${id}');return {x:g.ox+r.left+r.width/2,y:g.oy+r.top+r.height/2,label:(el.innerText||el.value||el.getAttribute('aria-label')||'').trim().slice(0,40)};})()`);
      if(!box)throw Error(id+' 요소가 없습니다. browser_read로 다시 확인하세요.');
      if(/좋아요/.test(browserRequest) && !/좋아요(?:를)?\s*(?:취소|해제)/.test(browserRequest)){
        const already=await evaluate(s,`(()=>{if(!/^(?:www\\.)?youtube\\.com$/.test(location.hostname))return false;const b=document.querySelector('[data-agent-id="${id}"]')?.closest('button');const name=b?.getAttribute('aria-label')||'';return /좋아요|like/i.test(name)&&!/싫어요|dislike/i.test(name)&&(b.getAttribute('aria-pressed')==='true'||/좋아요 취소|unlike|remove like/i.test(name));})()`);
        if(already)return '이미 좋아요가 켜져 있습니다. 현재 상태를 유지했습니다.';
      }
      if(/^(?:Chrome에 추가|Add to Chrome)$/iu.test(box.label)){
        const listing=new URL(await evaluate(s,'location.href'));
        if(listing.origin==='https://chromewebstore.google.com' && listing.pathname.startsWith('/detail/')){
          return '사용자 Chrome 프로필 확인 필요: '+listing.href;
        }
      }
      const before=await evaluate(s,PAGE_STATE), children=await childPages(s,page.id);
      for(const type of ['mouseMoved','mousePressed','mouseReleased'])
        await s.send('Input.dispatchMouseEvent',{type,x:box.x,y:box.y,button:'left',clickCount:1});
      return '클릭: '+id+' '+box.label+'\n\n'+await afterInput(s,page,before,children);
    }
    if(tool==='browser_type'){
      const target=String(action.target||'').trim().toUpperCase();
      if(!/^B\d+$/.test(target))throw await inputIdError(s);
      const ok=await evaluate(s,`(()=>{${FRAMES}const el=__find('${target}')?.el;if(!el || el.readOnly || el.disabled || !(el.isContentEditable || el.matches('textarea,input:is([type=text],[type=search],[type=email],[type=url],[type=tel],[type=password],[type=number],:not([type]))')))return false;el.scrollIntoView({block:'center'});el.focus();const scope=el.getRootNode();if((scope&&'activeElement' in scope?scope.activeElement:el.ownerDocument.activeElement)!==el)return false;if('value' in el){el.select();}else{const range=el.ownerDocument.createRange();range.selectNodeContents(el);const selection=el.ownerDocument.defaultView.getSelection();selection.removeAllRanges();selection.addRange(range);}return true;})()`);
      if(!ok)throw await inputIdError(s);
      if(String(action.text??'')===''){
        await s.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8});
        await s.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Backspace',code:'Backspace',windowsVirtualKeyCode:8});
      }else await s.send('Input.insertText',{text:String(action.text)});
      const value=await evaluate(s,`(()=>{${FRAMES}const el=__find('${target}')?.el;return el?('value' in el?el.value:el.textContent):null})()`);
      if(value!==String(action.text??''))throw Error('입력값이 일치하지 않습니다. browser_read로 입력칸과 포커스를 다시 확인하세요.');
      return '입력 확인: '+target+' = '+JSON.stringify(value);
    }
    if(tool==='browser_key'){
      const key=String(action.text||'Enter');
      const map={enter:['Enter',13],tab:['Tab',9],escape:['Escape',27],esc:['Escape',27],backspace:['Backspace',8]};
      const [name,code]=map[key.toLowerCase()]||[key,0];
      const before=await evaluate(s,PAGE_STATE), children=await childPages(s,page.id);
      for(const type of ['keyDown','keyUp'])
        await s.send('Input.dispatchKeyEvent',{type,key:name,code:name,windowsVirtualKeyCode:code,...(name==='Enter'&&type==='keyDown'?{text:'\r'}:{})});
      return '키: '+name+'\n\n'+await afterInput(s,page,before,children);
    }
    throw Error('지원하지 않는 브라우저 동작');
  }catch(error){
    if((destination || action.tool==='browser_preview') && !navigated && (owner||bridge)){
      s?.close();s=null;
      await closeBrowser().catch(()=>{});
    }
    throw error;
  }finally{s?.close();}
}
// 지금 페이지의 로그인 칸(비밀번호 칸과 그 앞의 아이디 칸)을 채우고 제출합니다.
// 값은 페이지 안에서만 쓰이고, 돌려주는 결과에는 값이 들어가지 않습니다(입력 확인 문장에 비밀번호가 찍히지 않게).
// 오류 메시지에도 값이 섞이지 않도록 모든 오류를 일반 문장으로 바꿉니다.
export async function fillLoginForm({username='',password}){
  const page=await pageTarget('browser_read');
  const s=await connect(page);
  try{
    const values=JSON.stringify({u:String(username),p:String(password)});
    const result=await evaluate(s,`(()=>{${FRAMES}const v=${values};
      const visible=e=>{const r=e.getBoundingClientRect(),c=e.ownerDocument.defaultView.getComputedStyle(e);return r.width>0&&r.height>0&&c.visibility!=='hidden'&&c.display!=='none'&&!e.disabled&&!e.readOnly;};
      const pw=__docs().flatMap(({d})=>[...d.querySelectorAll('input[type=password]')]).find(visible);
      if(!pw)return {ok:false,reason:'no-password-field'};
      const doc=pw.ownerDocument,HTMLInputElement=doc.defaultView.HTMLInputElement,Node=doc.defaultView.Node;
      const scope=pw.form||doc;
      const fields=[...scope.querySelectorAll('input')].filter(e=>visible(e)&&/^(text|email|tel|number|)$/i.test(e.type||'text')&&!/search|captcha|otp/i.test((e.name||'')+' '+(e.id||'')));
      const before=fields.filter(e=>e.compareDocumentPosition(pw)&Node.DOCUMENT_POSITION_FOLLOWING);
      const user=before.at(-1)||fields[0];
      const set=(e,val)=>{e.focus();const d=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');d.set.call(e,val);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));};
      if(v.u&&user)set(user,v.u);
      set(pw,v.p);
      const form=pw.form;
      const button=(form||doc).querySelector('button[type=submit],input[type=submit]')||[...(form||doc).querySelectorAll('button,a,input[type=button]')].find(b=>visible(b)&&/로그인|log\\s*in|sign\\s*in|확인/i.test(b.innerText||b.value||''));
      if(button)button.click();else if(form&&form.requestSubmit)form.requestSubmit();
      else pw.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,bubbles:true}));
      return {ok:true,filledUser:Boolean(v.u&&user),submitted:true};
    })()`).catch(()=>({ok:false,reason:'script-error'}));
    if(result?.ok)await waitLoad(s,true).catch(()=>{});
    return result;
  }finally{s.close();}
}

export async function latestChannelVideo(channelUrl){
  const u=new URL(channelUrl);
  if(u.origin!=='https://www.youtube.com'||!/^\/(?:@[^/]+|channel\/[^/]+)\/?$/.test(u.pathname))throw Error('채널 주소를 확인할 수 없습니다.');
  const parent=await connect(await pageTarget('browser_open'));
  let targetId;
  try{
    ({targetId}=await parent.send('Target.createTarget',{url:'about:blank',background:true}));
    const target=(await listPages()).find(p=>p.id===targetId);
    const tab=await connect(target);
    try{
      const dest=u.pathname.replace(/\/$/,'')+'/videos';
      await tab.send('Page.navigate',{url:u.origin+dest});
      for(let i=0;i<40;i++){
        const state=await evaluate(tab,`(()=>{
          const norm=s=>decodeURIComponent(s).replace(/\\/$/,'').toLowerCase();
          if(!document.body||location.origin!=='https://www.youtube.com'||norm(location.pathname)!==norm(${JSON.stringify(dest)}))return {};
          const els=[...document.querySelectorAll('yt-chip-cloud-chip-renderer,chip-shape')].filter(e=>e.getBoundingClientRect().height);
          const latest=els.find(e=>/^(최신순|최신|Latest|Newest)$/i.test(e.innerText.trim()));
          if(els.length && !latest)return {};
          if(latest && !latest.matches('[selected]') && !latest.querySelector('[aria-selected=true],[aria-pressed=true],.ytChipShapeActive') && latest.getAttribute('aria-selected')!=='true'){
            const chip=latest.querySelector('button,#chip-container')||latest;
            if(!latest.dataset.gemmaSelected){latest.dataset.gemmaSelected='1';chip.click();}return {};
          }
          const card=document.querySelector('ytd-rich-grid-renderer ytd-rich-item-renderer a#video-title-link,ytd-rich-grid-renderer ytd-rich-item-renderer a#video-title,ytd-rich-grid-renderer yt-lockup-view-model a.yt-lockup-metadata-view-model__title,ytd-rich-grid-renderer a.ytLockupMetadataViewModelTitle');
          if(card && /\\/watch\\?v=/.test(card.href))return {title:(card.title||card.innerText).trim()};
          if(/이 채널에 동영상이 없습니다|This channel has no videos/i.test(document.body.innerText))return {title:'공개 동영상 없음'};
          return {};
        })()`);
        if(state.title)return state.title;
        await new Promise(r=>setTimeout(r,500));
      }
      throw Error('동영상 탭의 최신순 첫 항목을 확인하지 못했습니다.');
    }finally{tab.close();}
  }finally{if(targetId)await parent.send('Target.closeTarget',{targetId}).catch(()=>{});parent.close();}
}
export async function subscriptionTabState(mode,entry){
  if(mode==='open')await browser({tool:'browser_open',text:entry});
  const tab=await connect(await pageTarget('browser_read'));
  try{
    return await evaluate(tab,`(()=>{
      const base={handle:0,pid:0};const mode=${JSON.stringify(mode)};
      if(location.hostname==='accounts.google.com')return {...base,state:/rejected/i.test(location.pathname)?'blocked':'login'};
      if(location.hostname!=='www.youtube.com'||location.pathname!=='/feed/channels')return {...base,state:'loading'};
      const nodes=[...document.querySelectorAll('ytd-channel-renderer')];
      const rows=nodes.flatMap(n=>{
        const a=n.querySelector('a.channel-link[href],a[href^="/@"],a[href^="/channel/"]'),name=n.querySelector('#channel-title #text,#channel-title')?.textContent.trim();
        return a && name?[name+' '+a.href]:[];
      });
      if(!rows.length){
        const login=document.querySelector('a[href*="ServiceLogin"],a[href*="accounts.google.com"][href*="sign"]');
        if(login&&mode==='signin')login.click();
        return {...base,state:login?'signin-required':'loading'};
      }
      const root=document.scrollingElement;
      if(mode==='top')window.scrollTo(0,0);
      if(mode==='scroll')window.scrollBy(0,Math.max(200,innerHeight*.85));
      const max=root.scrollHeight-root.clientHeight;
      return {...base,state:'ready',rows,position:max>0?Math.min(100,100*root.scrollTop/max):100};
    })()`);
  }finally{tab.close();}
}

export async function readImportantMail(url){
  await browser({tool:'browser_open',text:url});
  const session=await connect(await pageTarget('browser_read'));
  try{
    for(let attempt=0;attempt<20;attempt++){
      const result=await evaluate(session,`(()=>{
        if(location.hostname==='accounts.google.com')return {login:true};
        if(location.hostname!=='mail.google.com'||!/^#imp(?:$|\\/p[0-9]+$)/.test(location.hash))return {};
        const main=document.querySelector('[role="main"]');
        if(!main||main.getAttribute('aria-busy')==='true')return {};
        const subjects=[...main.querySelectorAll('tr.zA')].filter(el=>el.getClientRects().length).map(row=>row.querySelector('.bog')?.textContent?.trim()).filter(Boolean).slice(0,20);
        return {subjects,empty:!subjects.length && /중요(?:한)? (?:메일|대화)가 없습니다|no important (?:messages|conversations)/i.test(main.innerText)};
      })()`);
      if(result.login)throw Error('Gmail이 작업 탭에 로그인되어 있지 않아 중요 메일을 조회하지 못했습니다.');
      if(result.subjects?.length)return 'Gmail 중요 라벨에서 확인한 메일 ('+result.subjects.length+'개, 현재 화면 기준)\n'+result.subjects.map((v,i)=>(i+1)+'. '+v).join('\n');
      if(result.empty)return 'Gmail 중요 라벨에 표시된 메일이 없습니다.';
      await new Promise(resolve=>setTimeout(resolve,350));
    }
    throw Error('Gmail 중요 라벨의 메일 목록을 확인하지 못했습니다.');
  }finally{session.close();}
}
