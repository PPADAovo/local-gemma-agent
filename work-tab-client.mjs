import {appDataDir} from './app-data.mjs';
import net from 'node:net';
import {randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createInterface} from 'node:readline';
export async function connectWorkTab(viewOnly=false){
 if((!process.env.GEMMA_INBOX && !viewOnly) || process.env.AGENT_BROWSER_PORT)return null;
 const brand=process.env.GEMMA_BROWSER_BRAND==='edge'?'edge':'chrome';
 let socket;
 try{
  const {address}=JSON.parse(await fs.readFile(path.join(process.env.GEMMA_WORKTAB_TEST_DIR||appDataDir(),'work-tab-'+brand+'.json'),'utf8'));
  if(!/^\\\\\.\\pipe\\gemma-work-tab-[0-9a-f-]{36}$/.test(address))return null;
  socket=net.connect(address);
  await new Promise((ok,fail)=>{socket.once('connect',ok);socket.once('error',fail);});
 }catch{socket?.destroy();return null;}
 const pending=new Map();let seq=0;
 createInterface({input:socket}).on('line',l=>{let m;try{m=JSON.parse(l);}catch{return;}const p=pending.get(m.id);if(!p)return;
 pending.delete(m.id);clearTimeout(p.timer);if(m.error)p.fail(Error(m.error));else p.ok(m.value);});
 socket.on('error',()=>{});socket.on('close',()=>{for(const p of pending.values()){clearTimeout(p.timer);p.fail(Error('작업 탭 연결이 종료되었습니다.'));}pending.clear();});
 function call(op,args={}){
  if(socket.destroyed)return Promise.reject(Error('작업 탭이 닫혔습니다.'));
  return new Promise((ok,fail)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);fail(Error('작업 탭 응답 시간 초과'));},25000);pending.set(id,{ok,fail,timer});socket.write(JSON.stringify({id,op,args})+'\n');});
 }
 // The host checks the Windows owner of this per-connection pipe.
 const proof='gemma-client-'+randomUUID();
 const verifier=net.createServer(peer=>peer.end());
 try{
  await new Promise((ok,fail)=>verifier.once('error',fail).listen('\\\\.\\pipe\\'+proof,ok));
  await call('identify',{proof,pid:process.pid});
 }catch{socket.destroy();return null;}
 finally{verifier.close();}
 return {call,close(){socket.end();}};
}
if(['--show','--hide'].includes(process.argv[2]) && /^[0-9a-f-]{36}$/.test(process.argv[3]||'')){
 process.env.GEMMA_BROWSER_BRAND=process.argv[4]==='edge'?'edge':'chrome';
 const client=await connectWorkTab(true);
 if(client)try{await client.call(process.argv[2]==='--show'?'showSaved':'hideSaved',{ticket:process.argv[3]});}finally{client.close();}
}
