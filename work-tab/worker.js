const sessions=new Map();
const allowed=new Set(['Page.navigate','Page.getNavigationHistory','Page.navigateToHistoryEntry','Runtime.evaluate','Runtime.enable','Page.captureScreenshot','Input.dispatchKeyEvent','Input.dispatchMouseEvent','Input.insertText','Page.setInterceptFileChooserDialog']);
let port;
function connect(){
 if(port)return;
 port=chrome.runtime.connectNative('com.localgemma.worktab');
 port.onDisconnect.addListener(()=>{void chrome.runtime.lastError;port=null;for(const s of sessions.values())release(s);sessions.clear();});
 port.onMessage.addListener(async({session,id,op,args={}})=>{
  try{const value=await dispatch(session,op,args);if(id)port?.postMessage({session,id,value});}
  catch(e){if(id)port?.postMessage({session,id,error:e.message});}
 });
}
async function release(s){
 s.ended=true;
 for(const id of s.attached)await chrome.debugger.detach({tabId:id}).catch(()=>{});
 s.attached.clear();
 for(const id of s.ids){
  if(!s.keep)await chrome.tabs.remove(id).catch(()=>{});
  else if(s.group!==undefined){
   const tab=await chrome.tabs.get(id).catch(()=>null);
   if(tab?.groupId===s.group)await chrome.tabs.ungroup(id).catch(()=>{});
  }
 }
}
async function groupTab(s,id){
 if(s.ended)return;
 s.group=await chrome.tabs.group(s.group===undefined?{tabIds:[id]}:{groupId:s.group,tabIds:[id]});
 await chrome.tabGroups.update(s.group,s.label);
}
async function attach(s,id){
 if(s.stopped)throw Error('사용자가 작업을 취소했습니다.');
 if(!s.ids.has(id))throw Error('작업용 탭이 아닙니다.');
 if(s.attached.has(id))return;
 await chrome.debugger.attach({tabId:id},'1.3');
 s.attached.add(id);
 await chrome.debugger.sendCommand({tabId:id},'Page.enable');
 await chrome.debugger.sendCommand({tabId:id},'Page.setInterceptFileChooserDialog',{enabled:true});
 // 작업 탭의 다운로드는 "저장 위치 묻기" 창 없이 바로 다운로드 폴더에 저장합니다.
 // (그 창은 Windows 기본 대화상자라 에이전트가 누를 수 없어서, 파일이 .tmp로 멈춘 채 끝나지 않았습니다.)
 if(s.downloadPath)await chrome.debugger.sendCommand({tabId:id},'Page.setDownloadBehavior',{behavior:'allow',downloadPath:s.downloadPath}).catch(()=>{});
}
chrome.debugger.onDetach.addListener((src,reason)=>{
 for(const s of sessions.values()){
  if(!s.attached.delete(src.tabId) || s.ended || s.paused)continue;
  if(reason!=='canceled_by_user' && s.keep)continue;
  s.stopped=true;
  for(const id of [...s.attached]){
   s.attached.delete(id);
   chrome.debugger.detach({tabId:id}).catch(()=>{});
  }
 }
});
// 작업 탭이 연 탭은 다른 창(사이트의 공지·로그인 팝업 창)에 떠도 작업 범위에 넣습니다.
// 예전에는 같은 창의 탭만 넣어서, 팝업 창은 에이전트가 보지도 닫지도 못하고 작업이 끝나도 남았습니다.
chrome.tabs.onCreated.addListener(tab=>{for(const s of sessions.values())if(!s.ended && s.ids.has(tab.openerTabId)){
 s.ids.add(tab.id);
 if(tab.windowId===s.window)groupTab(s,tab.id).catch(()=>{});else (s.popups||=new Set()).add(tab.id);
}});
chrome.tabs.onRemoved.addListener(id=>{for(const [k,s] of sessions){s.ids.delete(id);s.attached.delete(id);if(!s.ids.size)sessions.delete(k);}});
async function dispatch(session,op,a){
 let s=sessions.get(session);
 if(op==='showSaved'||op==='hideSaved'){
  s=[...sessions.values()].find(state=>state.ticket===a.ticket);
  if(!s)throw Error('작업 창이 종료되었습니다.');
  if(op==='hideSaved'){await chrome.windows.update(s.window,{state:'minimized'});return;}
  op='show';
 }
 if(op==='create'){
  if(s)throw Error('작업 창이 이미 있습니다.');
  // 작업 창은 앞으로 가져오지 않습니다(focused:false). 앞으로 오면 사용자가 새로 여는 탭·입력이 작업 창으로 들어가
  // 사용자 탭과 작업 탭이 한 창에 섞였습니다. 작업 창은 앱의 [브라우저 보기]로 언제든 볼 수 있습니다.
  const w=await chrome.windows.create({url:'about:blank',type:'normal',focused:false,state:'normal'});
  const id=w.tabs[0].id;s={window:w.id,main:id,ticket:crypto.randomUUID(),ids:new Set([id]),attached:new Set(),label:a.label||{title:'🌐 웹 작업',color:'blue'},downloadPath:typeof a.downloadPath==='string'&&/^[A-Za-z]:\\/.test(a.downloadPath)?a.downloadPath:undefined};sessions.set(session,s);
  try{await attach(s,id);await groupTab(s,id);return {id:String(id),ticket:s.ticket};}
  catch(e){await release(s);sessions.delete(session);throw e;}
 }
 if(!s)return;
 if(op==='release'){if(!s.keep)sessions.delete(session);await release(s);return;}
 if(op==='suspend'){s.paused=true;for(const id of [...s.attached]){s.attached.delete(id);await chrome.debugger.detach({tabId:id}).catch(()=>{});}return;}
 if(op==='resume'){s.paused=false;return;}
 if(s.stopped && op!=='show')throw Error('브라우저에서 작업 탭 제어가 중지되었습니다.');
 if(op==='keep'){s.keep=true;return;}
 if(op==='show'){
  const last=await chrome.windows.get(s.window);const screens=await chrome.system.display.getInfo();
  const screen=screens.find(x=>last.left>=x.workArea.left&&last.left<x.workArea.left+x.workArea.width)||screens.find(x=>x.isPrimary)||screens[0];
  const b=screen.workArea,width=Math.min(b.width,Math.max(480,Math.floor(b.width*.48)));
  await chrome.windows.update(s.window,{state:'normal'});await chrome.windows.update(s.window,{left:b.left+b.width-width,top:b.top,width,height:b.height,focused:true});return;
 }
 const pages=async()=>Promise.all([...s.ids].map(async id=>{const t=await chrome.tabs.get(id);return {id:String(id),targetId:String(id),type:'page',openerId:t.openerTabId?String(t.openerTabId):undefined,workTab:true,popupWindow:t.windowId!==s.window};}));
 if(op==='list')return pages();
 if(op!=='command')throw Error('지원하지 않는 요청입니다.');
 if(s.paused)throw Error('사용자 입력을 기다리고 있습니다.');
 const id=Number(a.id);if(!s.ids.has(id))throw Error('작업 탭 범위를 벗어났습니다.');
 const m=a.method,p=a.params||{};
 if(m==='Target.getTargets')return {targetInfos:await pages()};
 if(m==='Target.createTarget'){const url=p.url||'about:blank';if(url!=='about:blank'&&!/^https?:\/\//i.test(url))throw Error('웹 주소만 열 수 있습니다.');const t=await chrome.tabs.create({windowId:s.window,url,active:false});s.ids.add(t.id);try{await groupTab(s,t.id);return {targetId:String(t.id)};}catch(e){await chrome.tabs.remove(t.id).catch(()=>{});throw e;}}
 if(m==='Target.closeTarget'){if(!s.ids.has(Number(p.targetId)))throw Error('잘못된 탭');await chrome.tabs.remove(Number(p.targetId));return {};}
 if(!allowed.has(m))throw Error('지원하지 않는 탭 동작입니다.');
 if(m==='Page.navigate'&&!/^https?:\/\//i.test(p.url))throw Error('웹 주소만 열 수 있습니다.');
 await attach(s,id);if(s.stopped)throw Error('사용자가 작업을 취소했습니다.');return chrome.debugger.sendCommand({tabId:id},m,p);
}
chrome.runtime.onStartup.addListener(connect);chrome.runtime.onInstalled.addListener(connect);chrome.action.onClicked.addListener(connect);
chrome.alarms.create('connect',{periodInMinutes:1});chrome.alarms.onAlarm.addListener(connect);connect();
