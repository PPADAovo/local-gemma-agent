import {execModelProcess} from './model-process-lifecycle.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
function budget(options,max){options.signal?.throwIfAborted();const left=Math.min(max,Number.isFinite(options.deadline)?options.deadline-Date.now():max);if(left<=0)throw Object.assign(Error('작업 시간 제한에 도달했습니다.'),{code:'TASK_DEADLINE'});return {timeout:Math.ceil(left),...(options.signal?{signal:options.signal}:{})};}

export async function executable(){
  const base=path.join(os.homedir(),'AppData','Local','OpenAI','Codex','bin');
  const builds=await fs.readdir(base,{withFileTypes:true}).catch(()=>[]);
  const candidates=[];
  for(const b of builds.filter(x=>x.isDirectory())){
    const file=path.join(base,b.name,'codex.exe');
    const stat=await fs.stat(file).catch(()=>null);
    if(stat?.isFile())candidates.push({file,time:stat.mtimeMs});
  }
  return candidates.sort((a,b)=>b.time-a.time)[0]?.file||'codex';
}
export async function status(options={}){
  try{
    const {stdout,stderr}=await execModelProcess(await executable(),['login','status'],{windowsHide:true,...budget(options,15000),deadline:options.deadline});
    if(/Logged in using ChatGPT/i.test(stdout+stderr))return {ok:true};
  }catch(error){if(options.signal?.aborted)throw options.signal.reason;if(error.code==='TASK_DEADLINE')throw error;}
  return {ok:false,message:'Codex의 ChatGPT 계정 로그인이 필요합니다. codex login으로 로그인하세요.'};
}
export async function complete(messages,format,{onProgress=()=>{},...control}={}){
  budget(control,300000);
  const auth=await status(control);if(!auth.ok)throw Error(auth.message);
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gemma-codex-'));
  try{
    const out=path.join(dir,'reply.txt');
    const args=['exec','--ignore-user-config','--skip-git-repo-check','--ephemeral','-s','read-only','--disable','shell_tool','--disable','apps','--disable','plugins','--disable','multi_agent','-C',dir,'-o',out];
    const context=[];
    for(const m of messages){
      context.push({role:m.role,content:m.content});
      for(const data of m.images||[]){
        const bytes=Buffer.from(data,'base64');
        const name=path.join(dir,'image-'+args.length+(bytes[0]===137?'.png':'.jpg'));
        await fs.writeFile(name,bytes);args.push('-i',name);
      }
    }
    const prompt='Provide the next assistant response to this conversation. Perform no tool actions. '+(format?'Output only JSON matching '+JSON.stringify(format):'')+'\n'+JSON.stringify(context);
    onProgress('로그인한 ChatGPT 계정으로 응답을 기다리고 있어요.');
    const exe=await executable();
    await execModelProcess(exe,[...args,'-'],{windowsHide:true,...budget(control,300000),deadline:control.deadline,maxBuffer:16*1024*1024},prompt).catch(error=>{if(error.code==='TASK_DEADLINE'||control.signal?.aborted)throw control.signal?.reason||error;throw Error('Codex 요청 실패. ChatGPT 로그인, 네트워크, 구독 사용 한도를 확인하세요.');});
    const answer=(await fs.readFile(out,'utf8')).trim();
    if(!answer)throw Error('ChatGPT 응답이 비었습니다.');
    return format?JSON.stringify(JSON.parse(answer.replace(/^\s*```(?:json)?\s*|\s*```\s*$/gi,''))):answer;
  }finally{await fs.rm(dir,{recursive:true,force:true});}
}
