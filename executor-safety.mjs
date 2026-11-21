import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const within=(base,file)=>{const rel=path.relative(path.resolve(base),path.resolve(file));return rel===''||(!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel));};
export async function selectedProjectRoot(defaultRoot,selected){
  if(!selected)return defaultRoot;
  const full=await fsp.realpath(selected);
  if(!(await fsp.stat(full)).isDirectory())throw Error('선택한 프로젝트가 폴더가 아닙니다.');
  return full;
}
export function checkedExternalPath(full,{home,projectRoot,protectedRoots=[]}){
  full=path.resolve(full);
  if(!within(home,full)&&!(projectRoot&&within(projectRoot,full)))throw Error('사용자 또는 선택한 프로젝트 폴더 밖의 파일은 다룰 수 없습니다.');
  if(protectedRoots.some(base=>within(base,full)))throw Error('앱 복구 기록은 일반 파일 도구로 다룰 수 없는 보호 경로입니다.');
  const rel=path.relative(home,full);
  if(/^(\.ssh|\.gnupg|\.aws|\.azure|\.kube|AppData[\\/](Roaming[\\/]Microsoft[\\/](Credentials|Protect|Crypto)|Local[\\/]Microsoft[\\/]Credentials)|AppData[\\/]Local[\\/](Google|Microsoft[\\/]Edge)[\\/].*User Data)([\\/]|$)/i.test(rel))throw Error('보안상 이 폴더는 다룰 수 없습니다.');
  let current=path.parse(full).root;
  for(const part of full.slice(current.length).split(path.sep).filter(Boolean)){
    current=path.join(current,part);let stat;
    try{stat=fs.lstatSync(current);}catch(error){if(error.code==='ENOENT')break;throw error;}
    if(stat.isSymbolicLink()||(stat.isFile()&&stat.nlink>1))throw Error('연결 파일·폴더는 지원하지 않습니다. 실제 경로를 선택하세요.');
  }
  return full;
}
export function pageText(text,offset=0){
  if(!/^\d+$/.test(String(offset??0))||!Number.isSafeInteger(Number(offset)))throw Error('읽기 위치는 0 이상의 정수여야 합니다.');
  text=String(text);offset=Number(offset);const content=text.slice(offset,offset+6000);
  return JSON.stringify({offset,total:text.length,next:offset+content.length<text.length?offset+content.length:null,content});
}
export function canAutoNote(settings){return settings.memoryEnabled!==false&&settings.autoMemory!==false;}
export function assertWebControl(settings){if(settings.webEnabled===false||settings.webMode==='off'||settings.computerUse===false||settings.disabledApps?.some(a=>/^(?:chrome|google chrome|크롬)$/i.test(a)))throw Error('설정에서 Chrome 또는 인터넷 제어가 꺼져 있습니다.');}
export function turnOutcome(result){return {...(typeof result.complete==='boolean'?{complete:result.complete,needsInput:result.needsInput===true}:{}),events:Array.isArray(result.events)?result.events:[],...(result.undoManifest?{undoManifest:result.undoManifest}:{})};}
export function registerAttachment(map,file,root){
  file=path.resolve(file);map.set(file,file);
  if(within(root,file))map.set(path.relative(root,file),file);
  return file;
}
export async function readAttachmentPrefix(file,limit=48000){
  const handle=await fsp.open(file,'r');
  try{const buffer=Buffer.alloc(limit);const {bytesRead}=await handle.read(buffer,0,limit,0);return new TextDecoder('utf-8').decode(buffer.subarray(0,bytesRead),{stream:true});}
  finally{await handle.close();}
}
export function powerShellCommand(command){
  const body=Buffer.from(command,'utf8').toString('base64');
  return `[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $OutputEncoding=[Text.UTF8Encoding]::new($false); $PSDefaultParameterValues['*:Encoding']='utf8'; $ProgressPreference='SilentlyContinue'; $ErrorActionPreference='Stop'; $global:LASTEXITCODE=0;
$gemmaBody=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${body}'));
$gemmaTokens=$null;$gemmaErrors=$null;$gemmaAst=[Management.Automation.Language.Parser]::ParseInput($gemmaBody,[ref]$gemmaTokens,[ref]$gemmaErrors);
if($gemmaErrors.Count){throw $gemmaErrors[0].Message}
$gemmaGuard='; if(-not $?) { $gemmaFailureCode=$LASTEXITCODE; $global:LASTEXITCODE=0; $LASTEXITCODE=0; if($gemmaFailureCode){throw ("명령 실패: 종료 코드 "+$gemmaFailureCode)}; throw "PowerShell 명령 실패" }; if($LASTEXITCODE){$gemmaFailureCode=$LASTEXITCODE; $global:LASTEXITCODE=0; $LASTEXITCODE=0; throw ("프로그램 실패: 종료 코드 "+$gemmaFailureCode)};';
$gemmaEnds=@($gemmaAst.FindAll({param($node) (($node -is [Management.Automation.Language.PipelineAst]) -or ($node -is [Management.Automation.Language.AssignmentStatementAst])) -and (($node.Parent -is [Management.Automation.Language.NamedBlockAst]) -or ($node.Parent -is [Management.Automation.Language.StatementBlockAst]))},$true) | ForEach-Object {$_.Extent.EndOffset} | Sort-Object -Unique -Descending);
foreach($gemmaEnd in $gemmaEnds){$gemmaBody=$gemmaBody.Insert($gemmaEnd,$gemmaGuard)};
& ([scriptblock]::Create($gemmaBody)); if(-not $?){exit 1}; if($LASTEXITCODE){exit $LASTEXITCODE}`;
}
