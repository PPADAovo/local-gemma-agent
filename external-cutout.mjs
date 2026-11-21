import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import os from 'node:os';
import pngjs from './라이브러리/pngjs/lib/png.js';

const service = 'https://briaai-bria-rmbg-1-4.hf.space';
const api = service + '/gradio_api';
const {PNG} = pngjs;
const pngSignature = Buffer.from('89504e470d0a1a0a', 'hex');

export const externalCutoutService = {
  name: 'BRIA RMBG-1.4',
  url: 'https://huggingface.co/spaces/briaai/BRIA-RMBG-1.4',
  license: 'https://huggingface.co/briaai/RMBG-1.4',
  usage: '공개 데모에 원본 사진을 업로드합니다. 비상업적 평가·데모 용도이며 서비스 상태에 따라 실패할 수 있습니다.'
};

async function request(url, options, stage) {
  const response = await fetch(url, {...options, redirect:'error'});
  if (!response.ok) throw Error(stage + ' 실패 (HTTP ' + response.status + ')');
  return response;
}

function prepareResult(bytes, crop, padding) {
  if (bytes.length < 33 || !bytes.subarray(0,8).equals(pngSignature)) throw Error('서비스에서 PNG를 반환하지 않았습니다.');
  if (bytes.readUInt32BE(16) * bytes.readUInt32BE(20) > 48_000_000) throw Error('결과 이미지가 너무 큽니다.');
  const png = PNG.sync.read(bytes);
  let left=png.width, right=0, top=png.height, bottom=0;
  let foregroundPixels=0, transparentPixels=0;
  for (let y=0; y<png.height; y++) {
    for (let x=0; x<png.width; x++) {
      const i=(y*png.width+x)*4;
      if (png.data[i+3] < 4) {
        png.data.fill(0, i, i+4);
        transparentPixels++;
      } else {
        if (png.data[i+3] >= 128) foregroundPixels++;
        left=Math.min(left,x); right=Math.max(right,x+1);
        top=Math.min(top,y); bottom=Math.max(bottom,y+1);
      }
    }
  }
  if (!foregroundPixels || !transparentPixels) throw Error('뚜렷한 전경과 투명 배경을 확인하지 못했습니다.');
  const bounds=[left,top,right,bottom];
  const cropBox=crop ? [Math.max(0,left-padding), Math.max(0,top-padding), Math.min(png.width,right+padding), Math.min(png.height,bottom+padding)] : [0,0,png.width,png.height];
  const width=cropBox[2]-cropBox[0], height=cropBox[3]-cropBox[1];
  const output = new PNG({width,height});
  PNG.bitblt(png,output,cropBox[0],cropBox[1],width,height,0,0);
  transparentPixels=0;
  for(let i=3;i<output.data.length;i+=4) if (output.data[i]===0) transparentPixels++;
  return {bytes:PNG.sync.write(output),width,height,originalWidth:png.width,originalHeight:png.height,bounds,cropBox,transparentPixels,foregroundPixels};
}

async function cropUpload(inputPath,region,signal) {
  if (!Array.isArray(region) || region.length!==4 || !region.every(n=>Number.isInteger(n)&&n>=0&&n<=1000)
      || region[0]>=region[2] || region[1]>=region[3]) throw Error('영역은 0~1000의 [왼쪽, 위, 오른쪽, 아래]로 지정하세요.');
  const file=path.join(os.tmpdir(),'gemma-upload-'+randomUUID()+'.png');
  // Keep paths out of the command; the native decoder only prepares the selected crop for upload.
  const script=[
    "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Drawing",
    "$im=[Drawing.Bitmap]::new($env:GEMMA_CROP_INPUT)",
    "try{$r=$env:GEMMA_CROP_REGION.Split(',')",
    "$x=[int][Math]::Floor($im.Width*[int]$r[0]/1000);$y=[int][Math]::Floor($im.Height*[int]$r[1]/1000)",
    "$w=[int][Math]::Ceiling($im.Width*[int]$r[2]/1000)-$x;$h=[int][Math]::Ceiling($im.Height*[int]$r[3]/1000)-$y",
    "if($w -lt 2 -or $h -lt 2){throw 'ROI too small'}",
    "$tile=$im.Clone([Drawing.Rectangle]::new($x,$y,$w,$h),[Drawing.Imaging.PixelFormat]::Format32bppArgb)",
    "try{$tile.Save($env:GEMMA_CROP_OUTPUT,[Drawing.Imaging.ImageFormat]::Png)}finally{$tile.Dispose()}",
    "@($im.Width,$im.Height,$x,$y,($x+$w),($y+$h)) -join ','}finally{$im.Dispose()}"
  ].join('\n');
  try {
    const {stdout}=await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,timeout:20000,signal,env:{...process.env,GEMMA_CROP_INPUT:path.resolve(inputPath),GEMMA_CROP_REGION:region.join(','),GEMMA_CROP_OUTPUT:file}});
    const [width,height,...box]=stdout.trim().split(',').map(Number);
    if (width*height>48_000_000) throw Error('원본 이미지가 너무 큽니다.');
    return {source:await fs.readFile(file),width,height,box};
  } finally { await fs.rm(file,{force:true}); }
}
// The caller chooses this external upload explicitly and enforces its workspace/approval rules.
export async function cutoutPhotoExternal(inputPath, outputPath, {crop=true,padding=0,region,signal}={}) {
  if (typeof crop!=='boolean' || !Number.isSafeInteger(padding) || padding<0) throw Error('크롭 설정과 0 이상의 정수 여백을 지정하세요.');
  if (path.extname(outputPath).toLowerCase()!=='.png' || path.resolve(inputPath)===path.resolve(outputPath)) throw Error('원본과 다른 PNG 저장 경로를 사용하세요.');
  const tile=region!=null?await cropUpload(inputPath,region,signal):null;
  const source=tile?.source??await fs.readFile(inputPath);
  if(source.length<12) throw Error('빈 이미지 또는 손상된 이미지입니다.');
  let extension, mime;
  if (source.subarray(0,8).equals(pngSignature)) { extension='png'; mime='image/png'; }
  else if (source.readUInt16BE(0)===0xffd8) { extension='jpg'; mime='image/jpeg'; }
  else if (source.toString('ascii',0,4)==='RIFF' && source.toString('ascii',8,12)==='WEBP') { extension='webp'; mime='image/webp'; }
  else throw Error('외부 누끼는 PNG, JPEG, WebP 사진을 지원합니다.');
  const name='photo.'+extension;
  const timer=AbortSignal.timeout(150000);
  const options={signal:signal?AbortSignal.any([timer,signal]):timer};
  const form=new FormData();
  form.append('files',new Blob([source],{type:mime}),name);
  const uploaded=await (await request(api+'/upload',{...options,method:'POST',body:form},'사진 업로드')).json();
  if(!Array.isArray(uploaded) || typeof uploaded[0]!=='string') throw Error('업로드 응답에 파일 참조가 없습니다.');
  const data=[{path:uploaded[0],orig_name:name,mime_type:mime,meta:{_type:'gradio.FileData'}}];
  const started=await (await request(api+'/call/run',{...options,method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({data})},'누끼 요청')).json();
  if(typeof started.event_id!=='string' || !started.event_id) throw Error('작업 접수 번호가 없습니다.');
  const events=await (await request(api+'/call/run/'+encodeURIComponent(started.event_id),options,'처리 상태 조회')).text();
  const complete=events.match(/^event: complete\r?\ndata: ([^\r\n]+)/m);
  if(!complete) throw Error('외부 누끼 서비스가 처리 결과를 반환하지 않았습니다. 서비스 대기열 또는 사용 가능 여부를 확인하세요.');
  const result=JSON.parse(complete[1]);
  const file=new URL(result[1]?.url || '',service);
  if(file.origin!==service || !file.pathname.startsWith('/gradio_api/file=')) throw Error('공식 서비스의 결과 파일 주소가 없습니다.');
  const resultBytes=Buffer.from(await (await request(file,options,'결과 다운로드')).arrayBuffer());
  let full=resultBytes;
  if(tile){
    const regionResult=PNG.sync.read(resultBytes);
    if(regionResult.width!==tile.box[2]-tile.box[0] || regionResult.height!==tile.box[3]-tile.box[1]) throw Error('반환 이미지와 선택 영역 크기가 다릅니다.');
    const canvas=new PNG({width:tile.width,height:tile.height,fill:true});
    canvas.data.fill(0);
    PNG.bitblt(regionResult,canvas,0,0,regionResult.width,regionResult.height,tile.box[0],tile.box[1]);
    full=PNG.sync.write(canvas);
  }
  const {bytes,...details}=prepareResult(full,crop,padding);
  details.regionBox=tile?.box??[0,0,details.originalWidth,details.originalHeight];
  const destination=path.resolve(outputPath), temp=destination+'.'+randomUUID()+'.tmp';
  await fs.mkdir(path.dirname(destination),{recursive:true});
  try { await fs.writeFile(temp,bytes,{flag:'wx'}); await fs.rename(temp,destination); }
  finally { await fs.rm(temp,{force:true}); }
  return {path:destination,...details,model:externalCutoutService.name,service:externalCutoutService.url,license:externalCutoutService.license};
}
