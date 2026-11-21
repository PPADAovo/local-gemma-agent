// 자꾸 실패하는 작업을 사람에게 넘기기: 관리자 PowerShell에서 직접 실행할 스크립트와 쉬운 설명을 만들어
// 사용자에게 실행을 부탁하고, 실행했다고 하면 결과만 확인합니다. 에이전트가 관리자 권한으로 직접 실행하지는 않습니다.
import fs from 'node:fs/promises';
import path from 'node:path';

export const HANDOFF_SCHEMA={type:'object',properties:{
  possible:{type:'boolean',description:'true only if a PowerShell script can really finish (or unblock) this task on this PC'},
  needsAdmin:{type:'boolean'},
  title:{type:'string',maxLength:60},
  explain:{type:'string',maxLength:600,description:'쉬운 한국어: 왜 직접 실행이 필요한지, 스크립트가 무엇을 하는지'},
  steps:{type:'array',maxItems:8,items:{type:'string',maxLength:160},description:'스크립트가 하는 일을 순서대로, 쉬운 한국어'},
  risks:{type:'string',maxLength:300,description:'지우거나 바꾸는 것, 되돌리는 법. 없으면 빈 문자열'},
  script:{type:'string',maxLength:6000},
  check:{type:'string',maxLength:300,description:'실행 후 무엇을 보면 성공인지'}
},required:['possible','needsAdmin','title','explain','steps','risks','script','check']};

// 사람이 실행하더라도 시스템을 망가뜨리거나 보안을 끄거나 외부 코드를 바로 실행하는 스크립트는 넘기지 않습니다.
const FORBIDDEN=[
  [/Format-Volume|\bformat\s+[a-z]:|diskpart|Clear-Disk|Initialize-Disk|bcdedit/i,'디스크·부팅 설정 변경'],
  [/Remove-Item[^\n]*\s['"]?[a-z]:\\?(?:Windows|Users|Program Files[^\\'"\s]*)?\\?['"]?(?:\s|$)/i,'시스템 폴더 통째 삭제'],
  [/Set-MpPreference|Add-MpPreference|DisableRealtimeMonitoring|Set-NetFirewallProfile[^\n]*-Enabled\s+False/i,'백신·방화벽 끄기'],
  [/Set-ExecutionPolicy[^\n]*(?:Unrestricted|Bypass)[^\n]*-Scope\s+LocalMachine/i,'컴퓨터 전체 실행 정책 해제'],
  [/(?:iex|Invoke-Expression)\b[^\n]*(?:iwr|irm|Invoke-WebRequest|Invoke-RestMethod|DownloadString|Net\.WebClient)|(?:iwr|irm|DownloadString)[^\n]*\|\s*(?:iex|Invoke-Expression)/i,'인터넷에서 받은 코드를 바로 실행'],
  [/-EncodedCommand|FromBase64String/i,'내용을 숨긴 명령'],
  [/net\s+user\s+\S+\s+\S+|Get-Credential|ConvertTo-SecureString|password\s*=/i,'계정·비밀번호 다루기'],
  [/reg(?:\.exe)?\s+delete\s+HKLM|Remove-Item[^\n]*HKLM:/i,'시스템 레지스트리 삭제']
];
export function unsafeScript(script){
  for(const [re,why] of FORBIDDEN)if(re.test(String(script||'')))return why;
  return '';
}

// 넘길 만큼 실패했는지: 실행형 작업이 끝나지 못했고, 사용자가 멈추거나 거부한 게 아니며, 실제 도구 실패가 여러 번 있었을 때.
export function shouldHandOff(result,{kind,minFailures=3}={}){
  if(!result || result.complete || kind!=='action')return false;
  // 사용자가 멈추거나 승인을 거부·취소한 경우만 제외합니다("액세스가 거부되었습니다" 같은 시스템 오류는 넘길 대상).
  if(/요청에 따라 작업을 중지|사용자가[^.]{0,20}(?:승인하지 않았|취소했|거부했)|계획 단계에서 작업을 중지/.test(String(result.answer||'')))return false;
  const failed=(result.events||[]).filter(e=>e.ok===false && !['check','plan','reply','wait'].includes(e.tool)).length;
  // 사람이 관리자 PowerShell로 대신 실행해야 풀리는 경우는 "권한" 문제뿐입니다. 도구를 잘못 고른 실수 등은 넘기지 않습니다.
  const permissionTrouble=/액세스가\s*거부|접근이\s*거부|권한이?\s*(?:없|부족|필요)|관리자\s*권한|Access\s+(?:is\s+)?denied|UnauthorizedAccess|requires?\s+elevation|elevated|EPERM|EACCES/i.test(String(result.answer||'')+' '+JSON.stringify(result.events||[]));
  // 메일·메시지 보내기, 로그인처럼 사용자 계정이 필요한 일은 스크립트로 넘기지 않습니다.
  const accountWork=/메일|gmail|카톡|카카오톡|메시지|보내|전송|로그인|결제|송금/i.test(String(result.task?.goal||'')+' '+String(result.answer||''));
  return failed>=minFailures && permissionTrouble && !accountWork;
}
// "실제 발송 로직(… 등 사용)", "여기에 … 넣으세요", TODO 같은 빈 자리 표시가 있으면 실제로 일을 끝내지 못하는 가짜 스크립트입니다.
export function placeholderScript(script){
  return /#\s*(?:실제|여기에|이곳에|TODO|FIXME|예시|예:)|등\s*사용\)|구현\s*필요|직접\s*(?:입력|작성)하세요|<[^>]{2,30}>|your[_-]?(?:password|email|key)/i.test(String(script||''));
}

export function handoffCard(plan,file){
  return [
    plan.explain.trim(),
    '',
    '이 스크립트가 하는 일:',
    ...plan.steps.map((s,i)=>(i+1)+'. '+s),
    ...(plan.risks?.trim()?['','⚠ 주의: '+plan.risks.trim()]:[]),
    '',
    '실행 방법:',
    plan.needsAdmin
      ? '1. 시작 버튼을 오른쪽 클릭 → "터미널(관리자)" 또는 "Windows PowerShell(관리자)"를 누르고, 권한 확인 창에서 [예]'
      : '1. 시작 메뉴에서 "PowerShell"을 엽니다(관리자 권한은 필요 없습니다)',
    '2. 아래 코드를 전부 복사해 붙여넣고 Enter',
    '3. 끝나면 [실행했어요]를 누르세요. 오류가 나면 빨간 글자를 복사해 답으로 붙여 주세요.',
    ...(file?['','같은 코드를 파일로도 저장했어요: '+file]:[]),
    '',
    '```powershell',
    plan.script.trim(),
    '```',
    '',
    '성공했는지 보는 법: '+plan.check
  ].join('\n');
}

export async function manualHandoff({input,result,spec,chat,askUser,root,log=()=>{}}){
  const failures=(result.events||[]).filter(e=>e.ok===false).slice(-6).map(e=>e.tool+(e.path?' '+e.path:'')).join(', ');
  let plan;
  try{
    plan=JSON.parse(await chat([
      {role:'system',content:'에이전트가 이 작업을 여러 번 시도했지만 끝내지 못했습니다. 사용자가 Windows PowerShell(필요하면 관리자)에서 직접 실행해 작업을 끝낼 수 있는 스크립트를 만드세요.\n'+
        '- 작업에 정말 필요한 것만 합니다. 요청에 없는 삭제·설치·설정 변경은 넣지 않습니다.\n- 바꾸기 전에 대상이 있는지 확인하고, 각 단계마다 Write-Host로 한국어 진행 상황을 출력하고, 마지막에 결과를 확인해 출력합니다.\n'+
        '- 파일을 지우거나 덮어쓰면 risks에 정확히 적습니다. 비밀번호·토큰은 스크립트에 넣지 않습니다.\n- 화면 클릭처럼 PowerShell로 할 수 없는 작업이면 possible=false.\n- 설명(explain, steps, risks, check)은 쉬운 한국어로, 코드나 영문 용어 없이.'},
      {role:'user',content:JSON.stringify({request:input,goal:spec?.goal||'',lastAnswer:String(result.answer||'').slice(0,800),failedTools:failures})}
    ],HANDOFF_SCHEMA));
  }catch(e){log('직접 실행 안내 만들기 실패: '+e.message);return null;}
  if(!plan?.possible || !String(plan.script||'').trim())return null;
  const unsafe=unsafeScript(plan.script);
  if(unsafe){log('직접 실행 안내를 넘기지 않음('+unsafe+')');return null;}
  if(placeholderScript(plan.script)){log('직접 실행 안내를 넘기지 않음(빈 자리 표시가 있는 미완성 스크립트)');return null;}
  let file='';
  if(root){
    try{
      const dir=path.join(root,'직접실행');await fs.mkdir(dir,{recursive:true});
      file=path.join(dir,(String(plan.title||'작업').replace(/[\\/:*?"<>|\s]+/g,'-').slice(0,40)||'작업')+'.ps1');
      // UTF-8 BOM: Windows PowerShell 5.1에서 한글 출력이 깨지지 않게
      await fs.writeFile(file,'﻿'+plan.script.trim()+'\r\n','utf8');
    }catch{file='';}
  }
  const answer=await askUser({kind:'question',title:'직접 실행해 주세요'+(plan.needsAdmin?' (관리자 PowerShell)':''),question:handoffCard(plan,file),options:['실행했어요','하지 않을게요']});
  log('직접 실행 안내 응답: '+String(answer||'').slice(0,200));
  if(!answer || answer==='하지 않을게요' || answer==='작업 중지')return {declined:true,plan,file};
  return {ran:true,plan,file,report:answer==='실행했어요'?'':String(answer)};
}
