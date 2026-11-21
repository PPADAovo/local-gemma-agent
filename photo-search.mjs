import path from 'node:path';
import fs from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';

const API = 'https://commons.wikimedia.org/w/api.php';
const MAX_BYTES = 4 * 1024 * 1024;
const agent = {'User-Agent': 'LocalGemma/1.0 (Wikimedia Commons photo search)'};

function plain(value) {
  const entities = {amp:'&', quot:'"', apos:"'", lt:'<', gt:'>', nbsp:' '};
  return String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (raw,key) => {
    if (!key.startsWith('#')) return entities[key] ?? raw;
    const n = key[1].toLowerCase()==='x' ? parseInt(key.slice(2),16) : Number(key.slice(1));
    return n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
  }).replace(/\s+/g, ' ').trim();
}

async function query(params, request) {
  const url = new URL(API);
  url.search = new URLSearchParams({
    action:'query', format:'json', formatversion:'2', prop:'imageinfo', iiprop:'mime|size|url|extmetadata',
    iiextmetadatafilter:'Artist|Credit|Attribution|LicenseShortName|LicenseUrl|ImageDescription', iiurlwidth:'960', ...params
  });
  const response = await request(url,{headers:agent, redirect:'error', signal:AbortSignal.timeout(20000)});
  if (!response.ok) throw Error('사진 검색 서버 응답 오류 '+response.status);
  const data = await response.json();
  if (data.error) throw Error('사진 정보 조회 실패: '+plain(data.error.info));
  return (data.query?.pages ?? []).sort((a,b)=>(a.index??0)-(b.index??0));
}

function candidate(page) {
  const info = page.imageinfo?.[0];
  if (!info || page.ns!==6 || info.mime!=='image/jpeg') return;
  const meta = info.extmetadata ?? {};
  const license = plain(meta.LicenseShortName?.value);
  if (!/^(?:CC BY(?:-SA)? [\d.]+|CC0(?: [\d.]+)?|Public domain)$/i.test(license)) return;
  const licenseUrl = plain(meta.LicenseUrl?.value).replace(/^http:/i,'https:') ||
    (/^public domain$/i.test(license) ? 'https://creativecommons.org/publicdomain/mark/1.0/' : '');
  const author = plain(meta.Attribution?.value || meta.Artist?.value || meta.Credit?.value);
  const previewUrl = info.thumburl || info.url;
  if (!author || !licenseUrl || !/^https:\/\/(?:thumb|upload)\.wikimedia\.org\//i.test(previewUrl) ||
      !/^https:\/\/commons\.wikimedia\.org\//i.test(info.descriptionurl)) return;
  return {id:String(page.pageid), title:plain(page.title.replace(/^File:/,'')), description:plain(meta.ImageDescription?.value).slice(0,180), author, license, licenseUrl,
    sourceUrl:info.descriptionurl, width:info.width, height:info.height, previewUrl};
}

export async function searchPhotos(text,{request=fetch}={}) {
  const q=String(text??'').trim();
  if (!q || q.length>200) throw Error('사진 검색어를 1~200자로 입력하세요.');
  const pages=await query({generator:'search',gsrsearch:q+' filetype:bitmap',gsrnamespace:'6',gsrlimit:'24'},request);
  const terms=q.toLowerCase().split(/\s+/).filter(w=>w.length>1);
  const cards=pages.map(candidate).filter(Boolean);
  const score=card=>terms.filter(w=>card.title.toLowerCase().includes(w)).length;
  return cards.sort((a,b)=>score(b)-score(a)).slice(0,8);
}

export async function savePhoto(id,file,{request=fetch,withSource=false}={}) {
  if (!/^\d{1,12}$/.test(String(id)) || !path.isAbsolute(file) || !/\.jpe?g$/i.test(file)) throw Error('검색 결과의 숫자 ID와 JPEG 저장 경로가 필요합니다.');
  const sidecar=file+'.source.json';
  async function existingSource(){
    try{return JSON.parse(await fs.readFile(sidecar,'utf8'));}
    catch(error){if(error.code==='ENOENT')return null;throw Error('기존 사진 출처 파일을 읽지 못했습니다. 다른 저장 경로를 선택하세요.');}
  }
  const digest=data=>createHash('sha256').update(data).digest('hex');
  const previous=withSource?await existingSource():null;
  if(previous?.id===String(id) && previous.sha256){
    const bytes=await fs.readFile(file).catch(error=>{if(error.code!=='ENOENT')throw error;});
    if(bytes){
      if(digest(bytes)!==previous.sha256)throw Error('기존 사진 내용이 변경되었습니다. 다른 저장 경로를 선택하세요.');
      return {...previous,file,bytes:bytes.length,reused:true};
    }
  }
  const [page]=await query({pageids:String(id)},request);
  const photo=page && String(page.pageid)===String(id) && candidate(page);
  if (!photo) throw Error('원본 페이지에서 사진과 이용 조건을 확인하지 못했습니다.');
  const response=await request(photo.previewUrl,{headers:agent,redirect:'error',signal:AbortSignal.timeout(25000)});
  if (!response.ok || !/^image\/jpeg(?:;|$)/i.test(response.headers.get('content-type')??''))
    throw Error('JPEG 이미지를 가져올 수 없습니다 ('+response.status+').');
  const chunks=[]; let size=0;
  for await(const chunk of response.body){
    size+=chunk.length;
    if(size>MAX_BYTES) throw Error('사진이 4 MiB를 넘습니다.');
    chunks.push(chunk);
  }
  const image=Buffer.concat(chunks);
  if(image.length<4 || image.readUInt16BE(0)!==0xffd8 || image.readUInt16BE(image.length-2)!==0xffd9)throw Error('JPEG 사진 데이터가 불완전합니다.');
  const receipt={id:String(id),title:photo.title,author:photo.author,license:photo.license,licenseUrl:photo.licenseUrl,sourceUrl:photo.sourceUrl,sha256:digest(image)};
  function matches(meta){
    return meta?.sourceUrl===receipt.sourceUrl && (!meta.sha256 || meta.sha256===receipt.sha256);
  }
  if(previous&&!matches(previous))throw Error('같은 이름의 다른 사진 출처가 있습니다. 다른 저장 경로를 선택하세요.');
  await fs.mkdir(path.dirname(file),{recursive:true});
  const temporary=file+'.'+randomUUID()+'.part';
  const temporaryMeta=temporary+'.json';
  let created=false;
  try {
    await fs.writeFile(temporary,image,{flag:'wx'});
    try{await fs.link(temporary,file);created=true;}
    catch(error){
      if(!withSource || error.code!=='EEXIST' || !(await fs.readFile(file)).equals(image))throw error;
    }
    if(withSource && !previous){
      await fs.writeFile(temporaryMeta,JSON.stringify(receipt,null,2),{flag:'wx'});
      try{await fs.link(temporaryMeta,sidecar);}
      catch(error){if(error.code!=='EEXIST' || !matches(await existingSource()))throw error;}
    }
  } catch(error){
    if(created)await fs.rm(file,{force:true});
    throw error;
  } finally {
    await Promise.all([fs.rm(temporary,{force:true}),fs.rm(temporaryMeta,{force:true})]);
  }
  return {...receipt,file,bytes:size,reused:!created};
}