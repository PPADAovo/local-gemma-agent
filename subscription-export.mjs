import {setTimeout as pause} from 'node:timers/promises';

export async function collectSubscriptions(read,progress=()=>{},delay=pause){
  await read('top');
  let last='',stable=0,stalls=0;
  const rows=new Map();
  for(;;){
    const page=await read('read');
    if(page.state!=='ready'||typeof page.position!=='number')throw Error('구독 목록의 끝 위치를 확인할 수 없습니다.');
    for(const line of page.rows){
      const match=line.match(/^(.*?)\s+(https:\/\/www\.youtube\.com\/(?:@|channel\/)[^\s]+)$/u);
      if(!match)throw Error('채널 링크를 확인할 수 없습니다.');
      const url=match[2].replace(/\/$/,'');
      const name=match[1].split(/\s+@/u)[0].replace(/\s+(인증됨|Verified)$/iu,'').trim();
      if(!name)throw Error('채널명을 확인할 수 없습니다.');
      rows.set(url,{url,name});
    }
    const signature=JSON.stringify([page.position,page.rows]);
    const end=page.position>=99.999;
    stable=end&&signature===last?stable+1:0;
    if(stable>=3)return [...rows.values()];
    stalls=!end&&signature===last?stalls+1:0;
    if(stalls>=3)throw Error('스크롤이 목록 끝에 도달하지 못했습니다.');
    progress('구독 채널 '+rows.size+'개 확인 · 스크롤 '+Math.round(page.position)+'%');
    last=signature;
    await read('scroll');
    await delay(end?1000:400);
  }
}

export function subscriptionCsv(rows,titles){
  const lines=[['순번','채널명','채널 링크','확인한 영상 제목'],...rows.map(({name,url},i)=>[String(i+1),name,url,titles.get(url)||''])];
  return '\uFEFF'+lines.map(line=>line.map(v=>'"'+v.replaceAll('"','""')+'"').join(',')).join('\r\n')+'\r\n';
}
