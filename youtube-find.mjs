import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
export function videoQuery(text){
  if(!/영상|유튜브|youtube|원곡|뮤직비디오/i.test(text)||/구독|방법|고쳐|오류|하지\s*마/.test(text))return '';
  if (/(?:창|탭|크롬|chrome|브라우저)(?:을|를)?\s*(?:하나|한\s*개)?\s*(?:열|띄우|띄워|켜|실행)/i.test(text)) return '';
  const m=text.trim().match(/^(.+?)\s*(?:찾아|검색해|틀어|재생해|보여)\s*(?:줘|주세요|봐)?[.!?]*$/);
  return m?m[1].replace(/유튜브(?:에서)?|(?:동?영상)(?:을|를)?/g,' ').trim():'';
}
export async function findVideo(query){
  const exe=path.join(os.homedir(),'.local','bin','yt-dlp.exe');
  const {stdout}=await promisify(execFile)(exe,['--ignore-config','--encoding','utf-8','--flat-playlist','--dump-json','--','ytsearch1:'+query],{windowsHide:true,timeout:45000,maxBuffer:3000000});
  const r=JSON.parse(stdout.trim());
  if(!/^[\w-]{11}$/.test(r.id)||!r.title)throw Error('유튜브 영상 링크를 확인하지 못했습니다.');
  return {title:r.title,url:'https://www.youtube.com/watch?v='+r.id};
}
