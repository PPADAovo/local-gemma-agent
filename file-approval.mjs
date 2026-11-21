// 파일 삭제·수정·덮어쓰기 승인 카드에 넣을 설명과 "물어야 하는지" 판단.
// 언제 묻는지는 권한 표(permission-policy.mjs)를 따릅니다. 물을 때는 파일마다 따로 묻습니다.
import path from 'node:path';
import {needsApproval} from './permission-policy.mjs';

const size=n=>n<1024?n+'B':n<1048576?(n/1024).toFixed(1)+'KB':(n/1048576).toFixed(1)+'MB';
const when=d=>{try{return new Date(d).toLocaleString('ko-KR',{hour12:false});}catch{return '';}};
const clip=(s,lines=4,chars=240)=>{const all=String(s??'').replace(/\r\n/g,'\n').split('\n');let out=all.slice(0,lines).join('\n');if(out.length>chars)out=out.slice(0,chars)+'…';return out+(all.length>lines?'\n…('+(all.length-lines)+'줄 더)':'');};
const mark=(sign,s)=>clip(s).split('\n').map(l=>sign+' '+l).join('\n');

// 권한 표(permission-policy.mjs)를 따릅니다: 삭제(백업됨)·원래 있던 파일 수정은 '승인 요청'·'나 대신 승인'에서 묻고,
// '전체 권한'에서는 묻지 않습니다(백업이 있어 실행 취소 가능). 새 파일은 '승인 요청'에서만 묻습니다.
export function mustAskFileChange({kind,permission,existed,createdThisTask}){
  if(kind==='delete')return needsApproval('file-delete',permission)===true;
  // 이번 요청에서 새로 만든 파일을 다듬는 것은 새 결과물로 봅니다.
  if(existed && !createdThisTask)return needsApproval('file-modify',permission)===true;
  return needsApproval('file-create',permission)===true;
}

export function describeFileChange({kind,full,stat,action={},createdThisTask=false}){
  const name=path.basename(full),dir=path.dirname(full);
  const head=({delete:'삭제할 파일',edit:'수정할 파일',rename:'이름을 바꿀 파일',write:stat?'덮어쓸 파일':'새로 만들 파일'})[kind]+': '+name+'\n위치: '+dir;
  const info=stat?'\n크기: '+size(stat.size)+' · 마지막 수정: '+when(stat.mtime)+(createdThisTask?' (이번 작업에서 만든 파일)':' (원래 있던 파일)'):'';
  let body='';
  if(kind==='delete')body='\n\n이 파일 하나만 지웁니다. 지우기 전에 복구기록에 백업해 두므로, 채팅의 실행 취소로 되돌릴 수 있어요.';
  else if(kind==='rename')body='\n\n새 이름: '+String(action.text??'').trim()+'\n내용은 그대로이고 이름만 바뀝니다.';
  else if(kind==='edit')body='\n\n바뀌는 부분:\n'+mark('-',action.old)+'\n'+mark('+',action.new)+'\n\n바꾸기 전 내용은 백업해 둡니다.';
  else if(stat)body='\n\n기존 내용 전체를 새 내용('+String(action.text??'').length+'자)으로 바꿉니다. 기존 내용은 백업해 둡니다.\n새 내용 앞부분:\n'+clip(action.text);
  else body='\n\n새 내용('+String(action.text??'').length+'자) 앞부분:\n'+clip(action.text);
  return head+info+body;
}

// 명령으로 지우는 경우(백업 없음): 권한 모드와 상관없이 묻고, 되돌릴 수 없다고 알립니다.
// Include common aliases and embedded runtimes. Arbitrary user programs cannot be
// proved read-only by a string scan; opaque evaluated code also needs review.
const DELETE_COMMAND=/\b(?:Remove-Item|rm|rmdir|rd|del|erase|ri|Clear-RecycleBin|Clear-Content)\b|\[(?:System\.)?IO\.(?:File|Directory)\]\s*::\s*(?:Delete|WriteAll(?:Text|Bytes|Lines)|OpenWrite|Create)\b|\b(?:os|shutil|fs|fsp|File|Directory)\s*(?:\?\.)?\.\s*(?:remove|unlink|rmtree|rmdir|rm|unlinkSync|rmSync|rmdirSync|Delete)\b|\.\s*(?:unlink|rmdir)\s*\(|\bgit\s+(?:clean|reset\s+--hard)\b|\b(?:Invoke-Expression|iex)\b|-(?:EncodedCommand|enc)\b|\b(?:python(?:3)?|py|node|ruby|perl)(?:\.exe)?\s+(?:-[^\s]+\s+)*-(?:c|e|Command)\b/i;
export function isDeleteCommand(command){
  const text=String(command||'').replace(/`(?=[a-z-])/gi,'');
  return DELETE_COMMAND.test(text)||/\.\s*Delete\s*\(|(?:^|[;(|])\s*&\s*(?:\$|\(|['"])/i.test(text);
}
export function describeDeleteCommand(command){
  const named=[...String(command).matchAll(/'([^']+)'|"([^"]+)"/g)].map(m=>m[1]||m[2]).filter(s=>/[\\/.]/.test(s));
  // 실제로 지우는 명령과, 프로그램을 실행하는 명령(무엇을 할지 미리 알 수 없음)을 구분해 알립니다.
  const deletes=/\b(?:Remove-Item|rm|rmdir|rd|del|erase|ri|Clear-RecycleBin|Clear-Content)\b|::\s*Delete\b|\.(?:unlink|rmdir|rmtree|remove)\b|\bgit\s+(?:clean|reset\s+--hard)\b/i.test(String(command));
  const head=deletes?'명령으로 파일을 지웁니다. 이 방법은 백업이 없어 되돌릴 수 없어요.'
    :'프로그램을 실행하는 명령이라, 무엇을 바꾸는지 미리 확인할 수 없어 승인을 받습니다. (파일 삭제 명령은 아닙니다)';
  return head+'\n'+(named.length?'명령에 나온 경로:\n'+named.map(s=>'· '+s).join('\n'):'대상이 명령 안에 직접 적혀 있지 않습니다.')+
    (/\*|-Recurse|\/s\b/i.test(command)?'\n\n⚠ 여러 파일이나 폴더 전체를 한꺼번에 지울 수 있는 명령입니다.':'');
}

// 일반 "코드로 작업" 경로: 설치된 프로그램(Program Files·%LOCALAPPDATA%\Programs)이 작업공간 안의 스크립트를 실행하는 명령은,
// 명령에 삭제가 없고 스크립트에 파일 삭제·프로세스 실행·네트워크·레지스트리 코드가 없으면 '나 대신 승인'에서 묻지 않습니다.
// (예: blender.exe --background --python 작업공간\의자.py). 그 밖의 프로그램 실행은 지금처럼 승인을 받습니다.
const UNSAFE_SCRIPT=/\b(?:import|from)\s+(?:os|subprocess|shutil|socket|ctypes|urllib|requests|http|winreg|webbrowser|ftplib|smtplib)\b|__import__|\b(?:os|shutil)\.|\.(?:unlink|rmdir|rmtree)\s*\(|Remove-Item|Start-Process|Invoke-WebRequest|WScript\.Shell|Scripting\.FileSystemObject|child_process|DeleteFile|\bkill\b/i;
export function installedProgramScriptRun(command,{root,programRoots=[],readScript}){
  const text=String(command||'');
  if(DELETE_COMMAND.test(text)||/[|;`]|&&|\|\||\$\(|>\s*\S/.test(text.replace(/^\s*&\s*/,'')))return false;
  const m=/^\s*&\s*["']([^"']+\.exe)["']\s+(.*)$/i.exec(text);
  if(!m)return false;
  const within=(base,file)=>{const rel=path.relative(path.resolve(base),path.resolve(file));return rel&&!rel.startsWith('..')&&!path.isAbsolute(rel);};
  if(!programRoots.some(base=>base&&within(base,m[1])))return false;
  const scripts=[...m[2].matchAll(/["']([^"']+\.(?:py|js|jsx|lua|scr|lsp|mel|ms|vbs))["']/gi)].map(x=>x[1]);
  if(!scripts.length||!scripts.every(file=>within(root,file)))return false;
  return scripts.every(file=>{const body=readScript(file);return typeof body==='string'&&!UNSAFE_SCRIPT.test(body);});
}
