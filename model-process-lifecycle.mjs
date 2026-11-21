import {execFile,execFileSync} from 'node:child_process';
// Kill descendants before the parent on Windows (.cmd and CLI launchers spawn children).
export async function stopModelProcess(child,{platform=process.platform,run=execFile}={}){
  if(!child)return;
  if(platform==='win32' && Number.isInteger(child.pid) && child.pid>0){
    try{await new Promise(resolve=>run('taskkill.exe',['/T','/F','/PID',String(child.pid)],{windowsHide:true,timeout:5000},error=>{if(error)try{child.kill();}catch{}resolve();}));}catch{try{child.kill();}catch{}}
  }else try{child.kill();}catch{}
}
export function stopModelProcessSync(child,{platform=process.platform,run=execFileSync}={}){
  if(!child)return;
  if(platform==='win32'&&Number.isInteger(child.pid)&&child.pid>0){try{run('taskkill.exe',['/T','/F','/PID',String(child.pid)],{windowsHide:true,stdio:'ignore',timeout:2000});return;}catch{}}
  try{child.kill();}catch{}
}
export function watchModelProcess(child,{signal,deadline}={},maxMs,onCancel){
  const state={error:null,dispose:()=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);}};
  const cancel=()=>{if(state.error)return;state.error=signal?.reason||Object.assign(Error('모델 응답 시간 제한에 도달했습니다.'),{code:'TASK_DEADLINE'});state.dispose();void stopModelProcess(child).finally(()=>onCancel(state.error));};
  const left=Math.min(maxMs,Number.isFinite(deadline)?deadline-Date.now():maxMs);
  const timer=setTimeout(cancel,Math.max(0,left));
  signal?.addEventListener('abort',cancel,{once:true});if(signal?.aborted)cancel();
  return state;
}
export function execModelProcess(file,args,{signal,deadline,timeout=300000,...options}={},input){
  signal?.throwIfAborted();
  if(Number.isFinite(deadline)&&deadline<=Date.now())throw Object.assign(Error('작업 시간 제한에 도달했습니다.'),{code:'TASK_DEADLINE'});
  return new Promise((resolve,reject)=>{
    let guard;
    const child=execFile(file,args,{...options,timeout:0},(error,stdout,stderr)=>{
      guard?.dispose();if(guard?.error)return reject(guard.error);
      if(error)return reject(error);resolve({stdout,stderr});
    });
    guard=watchModelProcess(child,{signal,deadline},timeout,reject);
    child.stdin?.on('error',()=>{});child.stdin?.end(input,'utf8');
  });
}
