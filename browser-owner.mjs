// This helper outlives a cancelled RPC long enough to close its own Chromium process.
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';

let cancelled=!process.connected;
let kept=false,stopGroups;
process.on('message',async m=>{
  if(m?.keep===true)kept=true;
  if(m?.endGroups){try{await stopGroups?.();}catch{}finally{if(process.connected)process.send({groupsEnded:true});}}
});
process.once('disconnect',()=>{cancelled=!kept;if(kept)stopGroups?.().catch(()=>{});});
const profile=await fs.mkdtemp(path.join(os.tmpdir(),'gemma-web-'));
let child,exited,debuggerUrl,finished=false;
async function groupController(browser,label){
  const pending=new Map();let seq=0,buffer='';
  browser.stdio[4].setEncoding('utf8').on('data',chunk=>{
    buffer+=chunk;let i;
    while((i=buffer.indexOf('\0'))>=0){
      const message=JSON.parse(buffer.slice(0,i));buffer=buffer.slice(i+1);
      const next=pending.get(message.id);
      if(next){clearTimeout(next.timer);pending.delete(message.id);message.error?next.reject(Error(message.error.message)):next.resolve(message.result);}
    }
  });
  browser.stdio[3].on('error',()=>{});
  const command=(method,params={},sessionId)=>new Promise((resolve,reject)=>{
    const id=++seq;
    const timer=setTimeout(()=>{pending.delete(id);reject(Error('탭 그룹 응답 시간 초과'));},4000);
    pending.set(id,{resolve,reject,timer});
    browser.stdio[3].write(JSON.stringify({id,method,params,sessionId})+'\0');
  });
  const {id}=await command('Extensions.loadUnpacked',{path:fileURLToPath(new URL('./작업탭그룹/',import.meta.url))});
  let target;
  for(let i=0;i<40&&!target;i++){
    const {targetInfos}=await command('Target.getTargets');
    target=targetInfos.find(t=>t.type==='service_worker' && t.url==='chrome-extension://'+id+'/worker.js');
    if(!target)await delay(75);
  }
  if(!target)throw Error('전용 창의 탭 그룹 확장을 시작하지 못했습니다.');
  const {sessionId}=await command('Target.attachToTarget',{targetId:target.targetId,flatten:true});
  const evaluate=async expression=>{
    const result=await command('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},sessionId);
    if(result.exceptionDetails)throw Error('탭 그룹 갱신 실패');
  };
  await evaluate('globalThis.startGroups('+JSON.stringify(label)+')');
  let stopping;
  return ()=>stopping??=(async()=>{await evaluate('globalThis.endGroups()');await command('Target.detachFromTarget',{sessionId});})();
}
try{
  if(!cancelled){
    const visible=process.env.GEMMA_VISIBLE_BROWSER==='1';
    child=spawn(process.argv[2],[...(visible?['--no-startup-window','--remote-debugging-pipe','--enable-unsafe-extension-debugging']:['--headless=new']),'--disable-gpu','--window-size=1280,900','--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--user-data-dir='+profile,'--no-first-run','--no-default-browser-check',...(visible?[]:['about:blank'])],{windowsHide:true,stdio:visible?['ignore','ignore','ignore','pipe','pipe']:'ignore'});
    exited=new Promise(resolve=>{
      child.once('error',()=>{finished=true;resolve();});
      child.once('exit',()=>{finished=true;resolve();});
    });
    let ready=false;
    for(let i=0;i<150 && !cancelled && !finished;i++){
      const data=await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8').catch(()=> '');
      const port=Number(data.split('\n')[0]);
      if(port>0 && port<65536){
        debuggerUrl='ws://127.0.0.1:'+port+data.split('\n')[1].trim();
        let groupError;
        if(visible)try{stopGroups=await groupController(child,JSON.parse(process.argv[3]||'{"title":"🌐 웹 작업","color":"blue"}'));}
        catch(e){groupError=e.message;}
        if(process.connected)process.send({port,pid:child.pid,visible,groupError});ready=true;break;
      }
      await delay(100);
    }
    if(!cancelled&&!ready)throw Error('작업 브라우저를 시작하지 못했습니다.');
    while(!cancelled&&!finished){
      await delay(kept?1500:150);
      if(kept && !process.connected){
        const targets=await fetch('http://127.0.0.1:'+new URL(debuggerUrl).port+'/json/list',{signal:AbortSignal.timeout(2000)}).then(r=>r.json()).catch(()=>[]);
        if(!targets.some(t=>t.type==='page'))cancelled=true;
      }
    }
  }
}catch(error){if(process.connected)process.send({error:error.message});}
finally{
  if(child&&!finished && debuggerUrl){
    const socket=new WebSocket(debuggerUrl);
    socket.onopen=()=>socket.send(JSON.stringify({id:1,method:'Browser.close'}));
    socket.onerror=()=>{};
    await Promise.race([exited,delay(1500,undefined,{ref:false})]);
    socket.close();
  }
  if(child&&!finished){child.kill();await exited;}
  await fs.rm(profile,{recursive:true,force:true,maxRetries:20,retryDelay:100});
  if(process.connected)process.disconnect();
}
