// Blender 어댑터: Python(bpy). 열린 실시간 창(blender_bridge.py)에 먼저 보내고, 없으면 띄우며, mode='background'면 배경 실행.
import fs from 'node:fs/promises';
import path from 'node:path';
import {runBlenderPython,checkBlenderCode} from '../blender-run.mjs';

async function detect(){
  if(process.env.GEMMA_BLENDER_EXE)return process.env.GEMMA_BLENDER_EXE;
  for(const root of [process.env.ProgramFiles,process.env['ProgramFiles(x86)']].filter(Boolean)){
    const base=path.join(root,'Blender Foundation');
    const dirs=(await fs.readdir(base).catch(()=>[])).sort().reverse();
    for(const d of dirs){const exe=path.join(base,d,'blender.exe');if(await fs.stat(exe).then(()=>true,()=>false))return exe;}
  }
  const {discoverCreativeApps}=await import('../creative-apps.mjs');
  return (await discoverCreativeApps('blender')).find(a=>a.id==='blender'&&a.installed)?.executable||null;
}

export default {
  id:'blender',name:'Blender',language:'Python(bpy)',kind:'3d',
  match:/\bblender\b|블렌더|블랜더/i,
  detect,
  check:checkBlenderCode,
  async run({exe,code,mode,name,outDir,size}){
    const r=await runBlenderPython({code,name,outDir,size,exe,live:mode==='background'?false:'launch'});
    return {...r,files:[r.blend,r.png].filter(Boolean),document:r.blend||'',state:r.objects||[]};
  }
};
