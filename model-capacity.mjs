import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const run=promisify(execFile);
const GiB=1024**3;
const finite=value=>Number.isFinite(value)&&value>=0;

export function modelCapacity(ram,free,commit,gpus,runners,currentModel){
  // On multi-GPU systems use the best single dedicated adapter. Ollama's
  // aggregate allocation cannot safely be credited to any particular adapter.
  const dedicated=gpus.reduce((best,gpu)=>!best||gpu.free>best.free?gpu:best,null);
  const current=runners.filter(m=>currentModel && ((m.name||m.model)===currentModel || (m.name||m.model)===currentModel+':latest'));
  const reusable=gpus.length===1?current.reduce((sum,m)=>sum+(finite(m.size_vram)?m.size_vram/GiB:0),0):0;
  const gpuAvailable=dedicated?Math.min(dedicated.total,dedicated.free+reusable):0;
  const hostAvailable=finite(ram)&&finite(free)&&finite(commit)?Math.min(free-3,commit-2):null;
  return {
    recordedAt:Date.now(),
    ramTotal:finite(ram)?ram:null,
    vramTotal:dedicated?.total??null,
    vramAvailable:dedicated?gpuAvailable:null,
    hostReady:hostAvailable===null?null:hostAvailable>=0,
    total:finite(ram)?ram+(dedicated?.total??0):null,
    available:hostAvailable===null?null:hostAvailable<0?0:Math.min(ram,hostAvailable)+gpuAvailable,
    ramOnly:!dedicated,
    resident:runners.map(m=>m.name||m.model).filter(Boolean)
  };
}

export async function probeCapacity(host,currentModel){
  const shell=process.env.SystemRoot?path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe'):'powershell.exe';
  const [gpus,runners,commit]=await Promise.all([
    run('nvidia-smi.exe',['--query-gpu=memory.total,memory.free','--format=csv,noheader,nounits'],{windowsHide:true,timeout:2200})
      .then(({stdout})=>stdout.trim().split(/\r?\n/).flatMap(line=>{
        const m=/^\s*(\d+)\s*,\s*(\d+)\s*$/.exec(line);
        return m && +m[1]>0 && +m[2]<=+m[1]?[{total:+m[1]/1024,free:+m[2]/1024}]:[];
      })).catch(()=>[]),
    fetch('http://127.0.0.1:11434/api/ps',{redirect:'error',signal:AbortSignal.timeout(1600)})
      .then(async r=>r.ok?(await r.json()).models:[]).catch(()=>[]),
    host?host.commit:process.platform==='win32'?run(shell,['-NoProfile','-Command',"$m=Get-CimInstance Win32_PerfRawData_PerfOS_Memory;[long]$m.CommitLimit-[long]$m.CommittedBytes"],{windowsHide:true,timeout:3500})
      .then(({stdout})=>/^\d+$/.test(stdout.trim())?Number(stdout.trim())/GiB:null).catch(()=>null):os.freemem()/GiB
  ]);
  return modelCapacity(host?host.total:os.totalmem()/GiB,host?host.free:os.freemem()/GiB,commit,gpus,Array.isArray(runners)?runners:[],currentModel);
}

export function fitsCapacity(size,model,capacity){
  if(capacity?.resident?.some(n=>n===model||n===model+':latest'))return true;
  if(capacity?.hostReady===false)return false;
  if(!capacity||capacity.available===null||!finite(size)||!size)return null;
  return size+1.5<=capacity.available;
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href){
  const values=process.argv.slice(2,5).map(v=>v==='unknown'?null:Number(v));
  const host=values.length===3?{total:values[0],free:values[1],commit:values[2]}:null;
  console.log(JSON.stringify(await probeCapacity(host,process.argv[5])));
}
