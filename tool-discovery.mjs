import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {discoverCreativeApps,isCreativeRequest} from './creative-apps.mjs';
const run=promisify(execFile);
const domains={recording:['ocam','obs64','SnippingTool','ffmpeg'],coding:['node','npm','git','dotnet','java','adb','gradle'],documents:['soffice','pdftotext','pandoc'],images:['ffmpeg','magick','uv'],browser:['chrome','msedge']};
async function findExecutable(name){
  if(!/^[a-z0-9_-]+$/i.test(name))return;
  if(name==='node')return process.execPath;
  if(process.platform==='win32' && name==='SnippingTool'){
    // Windows app execution aliases are special files and may fail fs.stat().
    const alias=path.join(process.env.LOCALAPPDATA,'Microsoft/WindowsApps/SnippingTool.exe');
    if(await fs.lstat(alias).then(()=>true,()=>false))return alias;
  }
  const dirs=(process.env.PATH||'').split(path.delimiter).filter(dir=>path.isAbsolute(dir));
  if(process.platform==='win32'){
    for(const base of [process.env.ProgramFiles,process.env['ProgramFiles(x86)'],process.env.LOCALAPPDATA].filter(Boolean)){
      dirs.push(path.join(base,'Google/Chrome/Application'),path.join(base,'Microsoft/Edge/Application'),path.join(base,'Microsoft/WinGet/Links'),path.join(base,'oCam'),path.join(base,'obs-studio/bin/64bit'),path.join(base,'Microsoft/WindowsApps'));
    }
  }
  for(const dir of new Set(dirs))for(const ext of (process.platform==='win32'?['.exe','.cmd','.bat']:[''])){
    const file=path.join(dir,name+ext);
    if(await fs.stat(file).then(stat=>stat.isFile(),()=>false))return file;
  }
}
export async function discoverTools(root,query=''){
  const term=String(query||'').trim().toLowerCase();
  const group=domains[term] || (/녹화|recording|오캠|캡처 도구|obs studio/i.test(term)?domains.recording:/코딩|검사|빌드|테스트/.test(term)?domains.coding:/사진|이미지|누끼/.test(term)?domains.images:/문서/.test(term)?domains.documents:null);
  const names=group||(!term?Object.values(domains).flat():[term]);
  const installed=(await Promise.all(names.map(async name=>{const executable=await findExecutable(name);return executable?{name,executable}:null;}))).filter(Boolean);
  const entries=await fs.readdir(root,{withFileTypes:true});
  const files=new Set(entries.filter(e=>e.isFile()).map(e=>e.name));
  const packageJson=files.has('package.json')?await fs.readFile(path.join(root,'package.json'),'utf8').then(JSON.parse).catch(()=>null):null;
  const checks=[];
  for(const script of ['typecheck','lint','test','build'])if(typeof packageJson?.scripts?.[script]==='string')checks.push({tool:'run',command:'npm run '+script});
  if(files.has('gradlew.bat'))checks.push({tool:'run',command:'.\\gradlew.bat test'});
  if(files.has('index.html'))checks.push({tool:'browser_preview',path:'index.html'});
  for(const file of [...files].filter(n=>/\.[cm]?js$/i.test(n)).slice(0,8))checks.push({tool:'project_check',path:file});
  const creativeApps=isCreativeRequest(term)?await discoverCreativeApps(term):[];
  return {installed,checks,...(isCreativeRequest(term)?{creativeApps}:{} )};
}
export async function checkJavaScript(file){
  if(!/\.[cm]?js$/i.test(file))throw Error('Node 구문 검사는 JavaScript 파일을 선택하세요.');
  try{
    await run(process.execPath,['--check',file],{windowsHide:true,timeout:30000});
    return {check:'Node.js 구문 검사',file,passed:true};
  }catch(e){
    throw Error('Node.js 구문 검사 실패: '+file+'\n'+String(e.stderr||e.message).slice(0,2200));
  }
}
