import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import pngjs from './라이브러리/pngjs/lib/png.js';
import {convertImage} from './external-media-tools.mjs';

const api='https://aihorde.net/api/v2/generate/';
const anonymousHeaders={apikey:'0000000000','Client-Agent':'LocalGemma:1.0:WindowsDesktop'};
const size=512, maxBytes=8*1024*1024;
const pngHeader=Buffer.from('89504e470d0a1a0a','hex');

export const imageGeneratorService={
  name:'AI Horde',
  url:'https://aihorde.net',
  usage:'텍스트 프롬프트를 외부 자원봉사 워커에 보냅니다. 가입·결제 없이 익명으로 이용하며, 혼잡하면 대기하거나 거절될 수 있습니다.'
};

async function json(method,route,signal,body) {
  const headers=body?{...anonymousHeaders,'Content-Type':'application/json'}:anonymousHeaders;
  const response=await fetch(api+route,{method,headers,body:body?JSON.stringify(body):undefined,signal,redirect:'error'});
  const chunks=[];
  let length=0;
  for await(const chunk of response.body??[]){
    length+=chunk.length;
    if(length>maxBytes*1.5)throw Error('이미지 서비스 응답이 너무 큽니다.');
    chunks.push(chunk);
  }
  let data;
  try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{}
  if(!response.ok)throw Error('AI Horde 요청 실패 (HTTP '+response.status+'): '+String(data?.message||response.statusText).slice(0,260));
  if(!data||typeof data!=='object')throw Error('AI Horde에서 유효한 처리 결과를 받지 못했습니다.');
  return data;
}

function verifyPNG(buffer) {
  if(buffer.length<33 || !buffer.subarray(0,8).equals(pngHeader) ||
      buffer.readUInt32BE(16)!==size || buffer.readUInt32BE(20)!==size)
    throw Error('생성 요청과 일치하는 512×512 PNG가 아닙니다.');
  const decoded=pngjs.PNG.sync.read(buffer);
  if(decoded.data.length!==size*size*4) throw Error('PNG 픽셀을 확인하지 못했습니다.');
}

export async function generateExternalImage(prompt,outputPath,{signal,onProgress=()=>{}}={}) {
  if(typeof prompt!=='string'||!prompt.trim()||prompt.length>1000) throw Error('1~1000자의 이미지 설명을 입력하세요.');
  if(typeof outputPath!=='string'||!outputPath||path.extname(outputPath).toLowerCase()!=='.png')throw Error('출력은 새 PNG 파일이어야 합니다.');
  const dest=path.resolve(outputPath);
  if(await fs.lstat(dest).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;}))throw Error('출력 파일이 이미 있습니다. 새 파일명을 선택하세요.');
  const timeout=AbortSignal.timeout(300000);
  const active=signal?AbortSignal.any([timeout,signal]):timeout;
  active.throwIfAborted();
  let id,complete=false,temp;
  try{
    const request=await json('POST','async',active,{prompt:prompt.trim(),params:{width:size,height:size,steps:20,n:1},
      models:['stable_diffusion','Deliberate'],nsfw:false,censor_nsfw:true,shared:false,r2:false});
    if(typeof request.id!=='string'||!/^[a-f\d-]{36}$/i.test(request.id))throw Error('이미지 작업 접수 번호가 없습니다.');
    id=request.id;
    onProgress('AI Horde가 이미지 생성을 접수했습니다.');
    let lastPosition;
    for(;;){
      const status=await json('GET','check/'+id,active);
      if(status.faulted)throw Error('외부 이미지 생성 작업이 실패했습니다.');
      if(status.done){complete=true;break;}
      if(status.queue_position!==lastPosition && Number.isSafeInteger(status.queue_position)){
        onProgress('이미지 생성 대기열 위치 '+status.queue_position);
        lastPosition=status.queue_position;
      }
      await delay(5000,undefined,{signal:active});
    }
    const result=await json('GET','status/'+id,active);
    const g=result.generations?.[0];
    if(!g || g.censored || ['censored','csam','faulted','cancelled'].includes(g.state) || typeof g.img!=='string' || !g.img.length)
      throw Error('서비스가 사용할 수 있는 생성 이미지를 반환하지 않았습니다.');
    if(g.img.length>Math.ceil(maxBytes*4/3)+4||!/^[A-Za-z0-9+/]+={0,2}$/.test(g.img))throw Error('생성 이미지의 바이트 형식 또는 크기가 올바르지 않습니다.');
    const original=Buffer.from(g.img,'base64');
    await fs.mkdir(path.dirname(dest),{recursive:true});
    temp=await fs.mkdtemp(path.join(path.dirname(dest),'.gemma-gen-'+randomUUID()+'-'));
    const png=path.join(temp,'output.png');
    if(original.subarray(0,8).equals(pngHeader)){
      verifyPNG(original);
      await fs.writeFile(png,original,{flag:'wx'});
    }else{
      if(original.length<12 || original.toString('ascii',0,4)!=='RIFF' || original.toString('ascii',8,12)!=='WEBP')
        throw Error('서비스가 WebP나 PNG 이미지로 응답하지 않았습니다.');
      const webp=path.join(temp,'generated.webp');
      await fs.writeFile(webp,original,{flag:'wx'});
      await convertImage(webp,png);
      verifyPNG(await fs.readFile(png));
    }
    active.throwIfAborted();
    const bytes=(await fs.stat(png)).size;
    await fs.link(png,dest);
    return {path:dest,width:size,height:size,bytes,model:g.model||'AI Horde',service:imageGeneratorService.url};
  }finally{
    if(id&&!complete)await fetch(api+'status/'+id,{method:'DELETE',headers:anonymousHeaders,redirect:'error',signal:AbortSignal.timeout(5000)}).catch(()=>{});
    if(temp)await fs.rm(temp,{recursive:true,force:true});
  }
}
