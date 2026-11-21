import assert from 'node:assert/strict';
import test from 'node:test';
import {parseRecordingRequest,runAgentLoop} from '../agent-loop.mjs';

const action=(tool,text='',path='')=>({tool,text,path,thought:'테스트'});

test('a request to verify an existing recording is not classified as a new recording',()=>{
  assert.equal(parseRecordingRequest('10초 화면 녹화 파일로 만들었는지 확인해 줘'),null);
});

test('a successful recording result is returned as an artifact without asking for a second file',async()=>{
  const file='화면녹화-test.mp4';
  const calls=[];
  let turn=0;
  const result=await runAgentLoop({
    input:'10초 화면 녹화 파일로 만들었는지 확인해 줘',
    settings:{computerUse:true,noSpec:true,toolAllow:['record_screen','look']},
    context:{},
    maxSteps:8,
    chat:async(_messages,format)=>{
      if(format.properties.verified)return JSON.stringify({verified:true,quote:file,gap:''});
      return JSON.stringify(turn++===0
        ? action('record_screen','10')
        : action('reply','화면 녹화 파일로 만들었습니다: '+file));
    },
    execute:async command=>{calls.push(command);return {file,bytes:128,seconds:10};}
  });
  assert.equal(calls.filter(call=>call.tool==='record_screen').length,1);
  assert.equal(calls.filter(call=>call.tool==='look').length,0);
  assert.ok(result.artifacts.includes(file));
  assert.equal(result.complete,true,result.answer);
});

test('one recording result completes only checklist steps supported by that result',async()=>{
  const calls=[];
  let actionTurn=0,evidenceChecks=0;
  const result=await runAgentLoop({
    input:'10초 화면 녹화해서 바탕화면에 저장하고 결과를 확인해 줘',
    settings:{computerUse:true,noSpec:true,toolAllow:['record_screen','look']},
    context:{},
    maxSteps:12,
    chat:async(messages,format)=>{
      if(format.properties.quote && !format.properties.verified && messages.at(-1).content.includes('"step"')){
        evidenceChecks++;
        const {step}=JSON.parse(messages.at(-1).content);
        return JSON.stringify({quote:/녹화|저장|10초/.test(step)?'capture.mp4':''});
      }
      if(format.properties.verified)return JSON.stringify({verified:true,quote:'capture.mp4',gap:''});
      return JSON.stringify([
        action('plan','녹화 시작\n10초 동안 녹화\n녹화를 저장'),
        action('record_screen','10'),
        action('reply','10초 녹화 결과를 저장했습니다: capture.mp4')
      ][actionTurn++]||action('reply','10초 녹화 결과를 저장했습니다: capture.mp4'));
    },
    execute:async command=>{calls.push(command);return {file:'capture.mp4',bytes:128,seconds:10};}
  });
  assert.equal(calls.filter(call=>call.tool==='record_screen').length,1);
  assert.equal(calls.filter(call=>call.tool==='look').length,0);
  assert.equal(evidenceChecks,3);
  assert.equal(result.complete,true,result.answer);
});

test('a recording result cannot satisfy a separate unsupported checklist step',async()=>{
  const calls=[];
  let actionTurn=0;
  const progress=[];
  const result=await runAgentLoop({
    input:'10초 화면 녹화해서 바탕화면에 저장하고 이메일도 확인해 줘',
    settings:{computerUse:true,noSpec:true,toolAllow:['record_screen','look']},
    context:{},
    maxSteps:10,
    progress:message=>progress.push(message),
    // 남은 작업 체크리스트는 채팅 대신 작업 로그에 남습니다.
    log:message=>progress.push(message),
    chat:async(messages,format)=>{
      if(format.properties.quote && !format.properties.verified && messages.at(-1).content.includes('"step"')){
        const {step}=JSON.parse(messages.at(-1).content);
        return JSON.stringify({quote:/녹화|저장|10초/.test(step)?'capture.mp4':''});
      }
      if(format.properties.verified)return JSON.stringify({verified:false,quote:'',gap:'이메일 결과 없음'});
      return JSON.stringify([
        action('plan','10초 녹화 저장\n이메일 확인'),
        action('record_screen','10'),
        action('reply','10초 녹화 결과를 저장했습니다: capture.mp4')
      ][actionTurn++]||action('reply','10초 녹화 결과를 저장했습니다: capture.mp4'));
    },
    execute:async command=>{calls.push(command);return {file:'capture.mp4',bytes:128,seconds:10};}
  });
  assert.equal(calls.filter(call=>call.tool==='record_screen').length,1);
  assert.equal(result.complete,false);
  assert.match(progress.join('\n'),/⬜ 이메일 확인/);
});

test('a saved browser capture is returned as an artifact without another capture',async()=>{
  const file='캡처/웹-test.png';
  const calls=[];
  let turn=0;
  const result=await runAgentLoop({
    input:'웹 페이지 캡처 파일로 만들었는지 확인해 줘',
    settings:{privateBrowser:true,noSpec:true,toolAllow:['browser_capture']},
    context:{},
    maxSteps:8,
    chat:async(messages,format)=>{
      if(format.properties.verified)return JSON.stringify({verified:true,quote:file,gap:''});
      if(messages.some(message=>String(message.content).includes('중복 실행 방지 경고')))
        return JSON.stringify(action('reply','캡처 파일로 저장했습니다: '+file));
      return JSON.stringify(turn++<2
        ? action('browser_capture','https://example.test')
        : action('reply','캡처 파일로 저장했습니다: '+file));
    },
    execute:async command=>{calls.push(command);return file;}
  });
  assert.equal(calls.filter(call=>call.tool==='browser_capture').length,1);
  assert.ok(result.artifacts.includes(file));
});

test('a saved screenshot receipt completes its matching file-existence step',async()=>{
  const file='캡처/화면-test.jpg';
  const calls=[];
  const progress=[];
  const task={
    kind:'action',access:'operate',surface:'desktop',desktop:'inspect',session:'existing',
    goal:'스크린샷 파일 저장',deliverable:file,steps:['생성된 스크린샷 파일이 저장되어 있는지 확인','저장된 캡처 파일 경로 확인'],
    tools:['look'],criteria:['스크린샷 파일이 저장됨'],done_when:'look 결과의 저장 경로 확인',missing:''
  };
  const result=await runAgentLoop({
    input:'스크린샷을 파일로 저장해 줘',
    settings:{computerUse:true,toolAllow:['look','reply']},
    context:{},
    maxSteps:8,
    progress:message=>progress.push(message),
    chat:async(messages,format)=>{
      if(format.properties.kind)return JSON.stringify(task);
      if(format.properties.quote && messages.at(-1).content.includes('"step"'))
        return JSON.stringify({quote:'Saved screenshot file: '+file});
      if(format.properties.checks)return JSON.stringify({
        checks:[{number:1,met:true,proof:[{id:1,line:1}],gap:''}],
        missing:'',
        stages:[
          {number:1,id:1,quote:'Saved screenshot file: '+file},
          {number:2,id:1,quote:'Saved screenshot file: '+file}
        ]
      });
      if(messages.some(message=>String(message.content).includes('[x] 1.')))return JSON.stringify(action('reply','스크린샷을 저장했습니다: '+file));
      return JSON.stringify(action('look'));
    },
    execute:async command=>{
      calls.push(command);
      return {image:'aGVsbG8=',imageWidth:1,imageHeight:1,elements:[],window:{title:'현재 화면',process:'desktop'},capturePath:file};
    }
  });
  assert.equal(calls.filter(command=>command.tool==='look').length,1);
  assert.ok(progress.some(message=>message.includes('확인 완료: 생성된 스크린샷 파일이 저장되어 있는지 확인')));
  assert.equal(result.complete,true,result.answer);
});

test('a saved file is read back without repeating its write',async()=>{
  const calls=[];
  let turn=0;
  const result=await runAgentLoop({
    input:'새 파일 result.txt에 본문을 써 줘',
    settings:{noSpec:true,toolAllow:['write','read']},
    context:{},
    maxSteps:6,
    chat:async(_messages,format)=>{
      if(format.properties.allow)return JSON.stringify({allow:true,reason:''});
      if(format.properties.verified)return JSON.stringify({verified:true,quote:'저장된 본문',gap:''});
      return JSON.stringify([
        {tool:'write',path:'result.txt',text:'본문',thought:'파일 저장'},
        {tool:'read',path:'result.txt',text:'',thought:'저장 결과 읽기'},
        action('reply','파일로 저장했습니다: result.txt')
      ][turn++]||action('reply','파일로 저장했습니다: result.txt'));
    },
    execute:async command=>{
      calls.push(command);
      return command.tool==='write'?'[[FILE:result.txt|||created]]':'저장된 본문';
    }
  });
  assert.equal(calls.filter(call=>call.tool==='write').length,1);
  assert.equal(calls.filter(call=>call.tool==='read').length,1);
  assert.equal(result.complete,true,result.answer);
});

test('a repeated service side effect is blocked and its first receipt is retained',async()=>{
  let sends=0,turn=0;
  const result=await runAgentLoop({
    input:'외부 서비스로 작업 하나 실행해 줘',
    settings:{noSpec:true,toolAllow:['plugin_call']},
    context:{},
    maxSteps:8,
    chat:async(messages,format)=>{
      if(format.properties.verified)return JSON.stringify({verified:true,quote:'영수증 msg-1',gap:''});
      if(messages.some(message=>String(message.content).includes('중복 실행 방지 경고')))return JSON.stringify(action('reply','작업이 완료되었습니다. 영수증 msg-1'));
      return JSON.stringify(turn++<2
        ? {tool:'plugin_call',path:'service.create_record',text:'{"name":"test"}',thought:'작업 실행'}
        : action('reply','작업이 완료되었습니다. 영수증 msg-1'));
    },
    execute:async()=>{sends++;return '영수증 msg-1';}
  });
  assert.equal(sends,1);
  assert.equal(result.complete,true);
});

test('a send confirmed as not executed ends with that failure instead of an uncertain or success answer',async()=>{
  let sends=0,turn=0;
  const result=await runAgentLoop({
    input:'외부 서비스로 작업 하나 실행해 줘',
    settings:{noSpec:true,toolAllow:['plugin_call']},
    context:{},
    maxSteps:8,
    chat:async(messages,format)=>{
      if(format.properties.verified)return JSON.stringify({verified:true,quote:'',gap:''});
      return JSON.stringify(turn++<3
        ? {tool:'plugin_call',path:'service.create_record',text:'{"name":"test"}',thought:'작업 실행'}
        : action('reply','작업이 완료되었습니다.'));
    },
    execute:async()=>{sends++;const e=Error('Gmail 발송 요청 한도(429)에 걸려 메일이 보내지지 않았습니다(보낸편지함에서 확인함).');e.notExecuted=true;throw e;}
  });
  assert.equal(sends,1);
  assert.equal(result.complete,false);
  assert.match(result.answer,/보내지지 않았습니다/);
  assert.doesNotMatch(result.answer,/불확실/);
});

test('a repeated PowerShell command is not executed again in the same task',async()=>{
  const commands=[];
  let turn=0;
  const result=await runAgentLoop({
    input:'캡처 파일이 존재하는지 확인해 줘',
    settings:{noSpec:true,toolAllow:['run']},
    context:{},
    maxSteps:8,
    chat:async(messages,format)=>{
      if(format.properties.verified)return JSON.stringify({verified:true,quote:'True',gap:''});
      if(messages.some(message=>String(message.content).includes('중복 실행 방지 경고')))
        return JSON.stringify(action('reply','캡처 파일이 존재합니다.'));
      return JSON.stringify(turn++<2
        ? {tool:'run',text:"Test-Path '캡처/화면-test.jpg'",path:'',thought:'캡처 파일 확인'}
        : action('reply','캡처 파일이 존재합니다.'));
    },
    execute:async command=>{commands.push(command);return 'True';}
  });
  assert.equal(commands.filter(command=>command.tool==='run').length,1);
  assert.equal(result.complete,true,result.answer);
});

test('a repeated service discovery reuses its first result',async()=>{
  const searches=[];
  let turn=0;
  const result=await runAgentLoop({
    input:'Gmail 도구를 확인해 줘',
    settings:{noSpec:true,toolAllow:['plugin_search']},
    context:{},
    maxSteps:8,
    chat:async(messages,format)=>{
      if(format.properties.verified)return JSON.stringify({verified:true,quote:'gmail.get_profile',gap:''});
      if(messages.some(message=>String(message.content).includes('중복 실행 방지 경고')))
        return JSON.stringify(action('reply','Gmail 조회 도구를 확인했습니다.'));
      return JSON.stringify(turn++<2
        ? action('plugin_search','gmail')
        : action('reply','Gmail 조회 도구를 확인했습니다.'));
    },
    execute:async command=>{searches.push(command);return 'gmail.get_profile';}
  });
  assert.equal(searches.filter(command=>command.tool==='plugin_search').length,1);
  assert.equal(result.complete,true,result.answer);
});

test('the same invalid service arguments stop before another recovery cycle',async()=>{
  const calls=[];
  let invalidProposals=0;
  const result=await runAgentLoop({
    input:'Gmail 테스트 메일을 보내 줘',
    settings:{noSpec:true,toolAllow:['plugin_search','plugin_call']},
    context:{},
    maxSteps:10,
    chat:async(_messages,_format,options)=>{
      if(options?.direct)return JSON.stringify({tool:'blocked',text:'인자 형식 오류',path:'',thought:'중복된 경로'});
      invalidProposals++;
      return JSON.stringify({
        tool:'plugin_call',
        path:invalidProposals%2?'gmail.send_email':'gmail.send_attached_email',
        text:'not-json-'+invalidProposals,
        thought:'메일 발송'
      });
    },
    execute:async command=>{calls.push(command);return 'gmail.get_profile schema';}
  });
  assert.equal(calls.filter(command=>command.tool==='plugin_call').length,0);
  assert.equal(invalidProposals,2);
  assert.equal(result.complete,false);
});

test('an uncertain service result is not retried automatically',async()=>{
  let calls=0,turn=0;
  const result=await runAgentLoop({
    input:'외부 서비스로 작업 하나 실행해 줘',
    settings:{noSpec:true,toolAllow:['plugin_call']},
    context:{},
    maxSteps:8,
    chat:async(messages,format)=>{
      if(format.properties.verified)return JSON.stringify({verified:false,quote:'',gap:'결과 불명'});
      if(messages.some(message=>String(message.content).includes('중복 실행 방지 경고')))return JSON.stringify(action('reply','작업 완료 여부가 불분명합니다.'));
      return JSON.stringify(turn++<2
        ? {tool:'plugin_call',path:'service.create_record',text:'{"name":"test"}',thought:'작업 실행'}
        : action('reply','작업 완료 여부가 불분명합니다.'));
    },
    execute:async()=>{calls++;throw Error('연결이 끊겼습니다.');}
  });
  assert.equal(calls,1);
  assert.equal(result.complete,false);
  assert.match(result.answer,/불분명|중복|확인/);
});

test('a repeated schedule registration is blocked',async()=>{
  let registrations=0,turn=0;
  const result=await runAgentLoop({
    input:'알람 예약해 줘',
    settings:{noSpec:true,toolAllow:['schedule_add']},
    context:{},
    maxSteps:6,
    chat:async(messages,format)=>{
      if(format.properties.verified)return JSON.stringify({verified:true,quote:'예약 영수증 15:30',gap:''});
      if(messages.some(message=>String(message.content).includes('중복 실행 방지 경고')))return JSON.stringify(action('reply','예약을 등록했습니다. 예약 영수증 15:30'));
      return JSON.stringify(turn++<2
        ? {tool:'schedule_add',text:'회의 알림',target:'once 15:30',path:'',thought:'예약 등록'}
        : action('reply','예약을 등록했습니다. 예약 영수증 15:30'));
    },
    execute:async()=>{registrations++;return '예약 영수증 15:30';}
  });
  assert.equal(registrations,1);
  assert.equal(result.complete,true);
});
