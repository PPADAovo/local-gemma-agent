import {withControlNotice} from './control-notice.mjs';
import {execFile} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {promisify} from 'node:util';

const run=promisify(execFile);
const codecs=new Map([['.jpg','mjpeg'],['.jpeg','mjpeg'],['.png','png'],['.webp','libwebp']]);

async function installedFfmpeg(){
  const exe=process.platform==='win32'?'ffmpeg.exe':'ffmpeg';
  const dirs=(process.env.PATH||'').split(path.delimiter).filter(dir=>path.isAbsolute(dir));
  if(process.platform==='win32'){
    // 다른 프로그램(다운로더 등)에 딸려 온 ffmpeg에 기대지 않습니다. 공식 경로만 봅니다.
    // winget 설치 직후에는 이 프로세스의 PATH가 갱신되지 않으므로 winget 폴더를 직접 찾습니다.
    const winget=path.join(process.env.LOCALAPPDATA||'','Microsoft','WinGet');
    dirs.push(path.join(winget,'Links'));
    const packages=path.join(winget,'Packages');
    for(const pkg of await fs.readdir(packages).catch(()=>[]))
      if(/^Gyan\.FFmpeg/i.test(pkg))
        for(const build of await fs.readdir(path.join(packages,pkg)).catch(()=>[]))dirs.push(path.join(packages,pkg,build,'bin'));
    for(const base of [process.env.ProgramFiles,process.env['ProgramFiles(x86)']].filter(Boolean))
      dirs.push(path.join(base,'ffmpeg','bin'));
  }
  for(const dir of new Set(dirs)){
    const executable=path.join(dir,exe);
    try{
      if(!(await fs.stat(executable)).isFile())continue;
      const {stdout}=await run(executable,['-version'],{windowsHide:true,timeout:5000,maxBuffer:128*1024});
      const version=stdout.match(/^ffmpeg version (\S+)/)?.[1];
      if(version)return {name:'ffmpeg',version,executable};
    }catch{}
  }
}

export async function desktopRecordingPath(name,{desktopPath,createDirectory=true}={}){
  const hint=' path에는 파일 이름만 쓰세요. 예: desktop_record.mp4';
  if(typeof name!=='string' || !name.trim())throw Error('바탕화면 녹화에는 안전한 MP4 파일명이 필요합니다.'+hint);
  let folder=desktopPath;
  if(!folder){
    if(process.platform!=='win32')throw Error('Windows 바탕화면 경로를 확인할 수 없습니다.');
    const {stdout}=await run('powershell.exe',['-NoProfile','-NonInteractive','-Command','[Environment]::GetFolderPath([Environment+SpecialFolder]::Desktop)'],{windowsHide:true,timeout:10000,maxBuffer:4096});
    folder=stdout.trim();
  }
  if(!path.isAbsolute(folder))throw Error('Windows 바탕화면의 실제 절대 경로를 확인하지 못했습니다.');
  // 모델은 흔히 "C:\Users\...\Desktop\x.mp4"처럼 전체 경로를 넘깁니다. 그 폴더가 바로 바탕화면이면 파일 이름만 씁니다.
  // 다른 폴더(상위 폴더 이동 포함)를 가리키면 바탕화면 밖에 쓰지 않도록 거절합니다.
  if(/[\\/]/.test(name)){
    const same=(a,b)=>path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase();
    if(!path.isAbsolute(name) || !same(path.dirname(name),folder))
      throw Error('바탕화면 녹화는 바탕화면 폴더에만 저장합니다('+folder+').'+hint);
    name=path.basename(name);
  }
  if(/[:]|[. ]$/.test(name) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(name) || !/\.mp4$/i.test(name))
    throw Error('바탕화면 녹화에는 안전한 MP4 파일명이 필요합니다.'+hint);
  if(createDirectory)await fs.mkdir(folder,{recursive:true});
  return path.join(folder,name);
}

export async function recordScreen(output,seconds,{findFfmpeg=installedFfmpeg,runCommand=run}={}){
  await fs.mkdir(path.dirname(output),{recursive:true});
  const engine=await findFfmpeg();
  if(!engine)throw Error('화면 녹화용 FFmpeg를 찾지 못했습니다. 설치: winget install --id Gyan.FFmpeg -e');
  const temp=path.join(path.dirname(output),randomUUID()+'.mp4');
  const options={windowsHide:true,timeout:(seconds+30)*1000};
  const encode=['-t',String(seconds),'-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-movflags','+faststart'];
  try{
    await withControlNotice(async()=>{
      // 주 모니터만 30fps로 녹화합니다(ddagrab, FFmpeg 6+). 모니터 여러 대를 한 줄로 이어 붙이면 메일 미리보기에서 화질이 크게 떨어집니다.
      try{
        await runCommand(engine.executable,['-nostdin','-hide_banner','-loglevel','error','-n','-f','lavfi','-i','ddagrab=output_idx=0:framerate=30:draw_mouse=1',
          '-vf','hwdownload,format=bgra,pad=ceil(iw/2)*2:ceil(ih/2)*2',...encode,temp],options);
      }catch(error){
        // 오래된 FFmpeg나 원격 데스크톱처럼 ddagrab을 못 쓰는 환경: 전체 바탕화면 gdigrab으로 대신합니다.
        await fs.rm(temp,{force:true});
        await runCommand(engine.executable,['-nostdin','-hide_banner','-loglevel','error','-n','-f','gdigrab','-framerate','30','-i','desktop',
          '-vf','pad=ceil(iw/2)*2:ceil(ih/2)*2',...encode,temp],options);
      }
    });
    const {size}=await fs.stat(temp);
    if(!size)throw Error('녹화 파일이 비어 있습니다.');
    await fs.copyFile(temp,output,fs.constants.COPYFILE_EXCL);
    return {file:output,bytes:size,seconds};
  }finally{await fs.rm(temp,{force:true});}
}

export async function discoverMediaTools(){
  const engine=await installedFfmpeg();
  return engine?[{name:engine.name,version:engine.version}]:[];
}

export async function convertImage(input,output,{maxWidth=8192,maxHeight=8192}={}){
  if(!path.isAbsolute(input)||!path.isAbsolute(output)||!codecs.has(path.extname(input).toLowerCase())||
     !codecs.has(path.extname(output).toLowerCase()))throw Error('로컬 JPEG, PNG, WebP 파일의 절대 경로를 지정하세요.');
  if(![maxWidth,maxHeight].every(n=>Number.isInteger(n)&&n>=1&&n<=8192))throw Error('변환 크기는 1~8192 사이의 정수여야 합니다.');
  const source=await fs.stat(input);
  if(!source.isFile()||source.size>48*1024*1024)throw Error('48 MiB 이하의 이미지 파일을 선택하세요.');
  if(await fs.lstat(output).then(()=>true,e=>{if(e.code!=='ENOENT')throw e;return false;}))throw Error('출력 경로에 파일이 있습니다. 새 파일명을 선택하세요.');
  const engine=await installedFfmpeg();
  if(!engine)throw Error('설치된 FFmpeg를 찾지 못했습니다.');
  const extension=path.extname(output).toLowerCase();
  const destination=path.dirname(output);
  await fs.mkdir(destination,{recursive:true});
  const tmp=path.join(destination,'.gemma-'+randomUUID()+extension);
  const common=['-nostdin','-hide_banner','-nostats','-protocol_whitelist','file','-max_pixels','48000000','-f','image2','-pattern_type','none'];
  const scale="scale=w='min(iw,"+maxWidth+")':h='min(ih,"+maxHeight+")':force_original_aspect_ratio=decrease";
  const opts={windowsHide:true,timeout:60000,maxBuffer:256*1024};
  try{
    const codec=codecs.get(extension);
    await run(engine.executable,[...common,'-i',input,'-frames:v','1','-vf',scale,'-map_metadata','-1','-c:v',codec,...(codec==='mjpeg'?['-q:v','3']:[]),'-update','1','-n',tmp],opts);
    const decoded=await run(engine.executable,[...common,'-i',tmp,'-frames:v','1','-f','null','-'],opts);
    const stream=decoded.stderr.split(/\r?\n/).find(line=>line.includes('Stream #0:0')&&line.includes('Video:'));
    const size=stream?.match(/(?:,|\s)\s*(\d{1,5})x(\d{1,5})(?:\s|,|$)/);
    if(!size||Number(size[1])>maxWidth||Number(size[2])>maxHeight)throw Error('변환 결과에서 요청한 크기를 확인하지 못했습니다.');
    const bytes=(await fs.stat(tmp)).size;
    await fs.link(tmp,output);
    return {tool:engine.name,version:engine.version,file:output,width:Number(size[1]),height:Number(size[2]),bytes};
  }finally{await fs.rm(tmp,{force:true});}
}

// Color-key removal is only appropriate when the same background is visible on all sides.
export async function cutoutFlatBackground(input,output){
  if(!path.isAbsolute(input)||!path.isAbsolute(output)||!codecs.has(path.extname(input).toLowerCase())||
      path.extname(output).toLowerCase()!=='.png')throw Error('사진 입력과 새 PNG 출력의 절대 경로를 지정하세요.');
  const source=await fs.stat(input);
  if(!source.isFile()||source.size>48*1024*1024)throw Error('48 MiB 이하 이미지가 필요합니다.');
  if(await fs.lstat(output).then(()=>true,e=>{if(e.code!=='ENOENT')throw e;return false;}))throw Error('출력 경로에 파일이 있습니다. 새 PNG 경로를 선택하세요.');
  const engine=await installedFfmpeg();
  if(!engine)throw Error('설치된 FFmpeg를 찾지 못했습니다.');
  const options={windowsHide:true,timeout:60000,encoding:'buffer'};
  const common=['-nostdin','-hide_banner','-nostats','-protocol_whitelist','file','-max_pixels','24000000','-f','image2','-pattern_type','none'];
  const size=48;
  const preview=await run(engine.executable,[...common,'-i',input,'-frames:v','1','-vf','scale=48:48:flags=area','-f','rawvideo','-pix_fmt','rgba','pipe:1'],{...options,maxBuffer:128*1024});
  const rgba=preview.stdout;
  if(rgba.length!==size*size*4)throw Error('단색 배경 샘플을 읽지 못했습니다.');
  const at=(x,y)=>rgba.subarray((y*size+x)*4,(y*size+x)*4+4);
  const corners=[];
  for(const dx of [0,size-4])for(const dy of [0,size-4])for(let y=0;y<4;y++)for(let x=0;x<4;x++)corners.push(at(dx+x,dy+y));
  const median=values=>values.sort((a,b)=>a-b)[Math.floor(values.length/2)];
  const color=[0,1,2].map(c=>median(corners.map(pixel=>pixel[c])));
  const near=p=>p[3]===255 && color.every((c,i)=>Math.abs(p[i]-c)<=16);
  const unsuitable=reason=>({suitable:false,tool:'ffmpeg',model:'ffmpeg-colorkey',reason});
  if(!corners.every(near))return unsuitable('네 모서리 색이 일치하지 않습니다. 자연 배경 전경 분리를 사용하세요.');
  for(const side of [i=>at(i,0),i=>at(i,size-1),i=>at(0,i),i=>at(size-1,i)]){
    if(Array.from({length:size},(_,i)=>near(side(i))).filter(Boolean).length<size*0.85)
      return unsuitable('가장자리 색이 고르지 않아 단색 배경으로 판별할 수 없습니다.');
  }
  const colorCode=color.map(n=>n.toString(16).padStart(2,'0')).join('');
  const dir=path.dirname(output);
  await fs.mkdir(dir,{recursive:true});
  const temp=path.join(dir,'.gemma-'+randomUUID()+'.png');
  try{
    await run(engine.executable,[...common,'-i',input,'-frames:v','1','-vf','format=rgba,colorkey=0x'+colorCode+':0.06:0.015','-c:v','png','-update','1','-n',temp],{...options,maxBuffer:256*1024});
    const decoded=await run(engine.executable,[...common,'-i',temp,'-frames:v','1','-vf','alphaextract','-pix_fmt','gray','-f','rawvideo','pipe:1'],{...options,maxBuffer:25000000});
    const stream=decoded.stderr.toString().split(/\r?\n/).find(line=>line.includes('Stream #0:0')&&line.includes('Video:'));
    const dimensions=stream?.match(/(?:,|\s)\s*(\d{1,5})x(\d{1,5})(?:\s|,|$)/);
    const width=Number(dimensions?.[1]),height=Number(dimensions?.[2]);
    const alpha=decoded.stdout;
    if(alpha.length!==width*height)throw Error('결과 이미지의 알파 채널을 확인할 수 없습니다.');
    let foregroundPixels=0,transparentPixels=0;
    for(const n of alpha){if(n>=128)foregroundPixels++;else if(n===0)transparentPixels++;}
    if(foregroundPixels<Math.max(4,alpha.length*0.005)||transparentPixels<alpha.length*0.05)return unsuitable('전경이나 투명 배경 면적이 충분하지 않습니다.');
    await fs.link(temp,output);
    return {suitable:true,model:'ffmpeg-colorkey',tool:engine.name,version:engine.version,file:output,path:output,width,height,foregroundPixels,transparentPixels,background:'#'+colorCode};
  }finally{await fs.rm(temp,{force:true});}
}
