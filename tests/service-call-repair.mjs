import test from 'node:test';
import assert from 'node:assert/strict';
import {parseArgsObject,runAgentLoop} from '../agent-loop.mjs';

const verdict=JSON.stringify({verified:true,quote:'abc',gap:'',checks:[],missing:''});
const sendSpec=[{name:'gmail.send_attached_email',inputSchema:{type:'object',properties:{to:{},subject:{},body:{},files:{}},required:['to']}}];

test('arguments with single-backslash Windows paths are still read',()=>{
  const broken=String.raw`{"to":"me","files":["C:\Users\User\Desktop\어디서나 작업\작업공간\desktop_record (2).mp4"]}`;
  assert.throws(()=>JSON.parse(broken));
  const args=parseArgsObject(broken);
  assert.equal(args.files[0],String.raw`C:\Users\User\Desktop\어디서나 작업\작업공간\desktop_record (2).mp4`);
  const fine=parseArgsObject(JSON.stringify({files:['C:\\a\\b.mp4']}));
  assert.equal(fine.files[0],'C:\\a\\b.mp4','already-correct JSON must not be changed');
});

test('path holds only the service name and the real tool sits in tool_name with a broken Windows path: the call still runs',async()=>{
  const sent=[];let turn=0;
  const text=String.raw`{"tool_name":"gmail.send_attached_email","arguments":{"to":"me","subject":"녹화","body":"영상","files":["C:\Users\User\Desktop\rec (2).mp4"]}}`;
  const steps=[{tool:'plugin_search',text:'gmail',path:'',thought:''},{tool:'plugin_call',text,path:'gmail',thought:''},{tool:'reply',text:'보냈습니다. 메시지 ID abc',path:'',thought:''}];
  await runAgentLoop({input:'녹화 파일 지메일로 나한테 보내',settings:{noSpec:true,manualHandoff:false},maxSteps:6,context:{},
    chat:async(m,f)=>f?.properties?.verified||f?.properties?.checks?verdict:JSON.stringify(steps[Math.min(turn++,steps.length-1)]),
    execute:async a=>{sent.push(a);return a.tool==='plugin_search'?sendSpec:'메시지 ID abc';}});
  const call=sent.find(a=>a.tool==='plugin_call');
  assert.equal(call?.path,'gmail.send_attached_email',JSON.stringify(sent.map(a=>a.tool+':'+a.path)));
  const args=JSON.parse(call.text);
  assert.equal(args.to,'me');
  assert.equal(args.files[0],String.raw`C:\Users\User\Desktop\rec (2).mp4`);
  assert.ok(!('tool_name' in args) && !('arguments' in args));
});

test('recording through a terminal ffmpeg command is switched to the recording tool',async()=>{
  const sent=[];let turn=0;
  const cmd=String.raw`"C:\Tools\ffmpeg\bin\ffmpeg.exe" -f gdigrab -i desktop -t 10 out.mp4`;
  const steps=[{tool:'run',text:cmd,path:'',thought:''},{tool:'run',text:cmd,path:'',thought:''},{tool:'reply',text:'녹화했습니다: rec.mp4',path:'',thought:''}];
  await runAgentLoop({input:'바탕화면 화면 10초 녹화해서 메일로 보내줘',settings:{noSpec:true,manualHandoff:false,computerUse:true},maxSteps:6,context:{},
    chat:async(m,f)=>f?.properties?.verified||f?.properties?.checks?verdict:JSON.stringify(steps[Math.min(turn++,steps.length-1)]),
    execute:async a=>{sent.push(a.tool+':'+a.text);return a.tool==='record_screen'?{file:'rec.mp4',bytes:10,seconds:10}:'ok';}});
  assert.ok(sent.includes('record_screen:10'),sent.join(' | '));
  assert.ok(!sent.some(s=>s.startsWith('run:')),sent.join(' | '));
});

test('normalizeServiceCall puts the tool name in path and leaves only real arguments, whatever shape the model used',async()=>{
  const {normalizeServiceCall}=await import('../agent-loop.mjs');
  const specs=[{name:'gmail.send_attached_email',inputSchema:{type:'object',properties:{to:{},subject:{},body:{},files:{}},required:['to']}},{name:'gmail.get_profile',inputSchema:{type:'object',properties:{}}}];
  const want={to:'me',subject:'s',body:'b',files:[String.raw`C:\Users\User\Desktop\rec.mp4`]};
  const shapes=[
    // 실제 기록: 입력 뒤에 이름이 찌꺼기로 붙고 path는 빔, 경로 역슬래시도 하나
    {path:'',text:String.raw`{"to":"me","subject":"s","body":"b","files":["C:\Users\User\Desktop\rec.mp4"]}","path":"gmail.send_attached_email"`},
    // 실제 기록: path에 서비스 이름만, 진짜 이름은 tool_name
    {path:'gmail',text:String.raw`{"tool_name":"gmail.send_attached_email","arguments":{"to":"me","subject":"s","body":"b","files":["C:\Users\User\Desktop\rec.mp4"]}}`},
    // 이름 없이 인자만
    {path:'',text:JSON.stringify(want)},
    // 이름을 입력 안에 한 번 더
    {path:'gmail.send_attached_email',text:JSON.stringify({tool:'gmail.send_attached_email',...want})},
    // 올바른 호출은 그대로
    {path:'gmail.send_attached_email',text:JSON.stringify(want)}
  ];
  for(const shape of shapes){
    const fixed=normalizeServiceCall(shape,specs);
    assert.equal(fixed.path,'gmail.send_attached_email',shape.text.slice(0,60));
    assert.deepEqual(JSON.parse(fixed.text),want,shape.text.slice(0,60));
  }
  assert.equal(normalizeServiceCall(shapes[4],specs).note,'','a correct call is not touched');
  const profile=normalizeServiceCall({path:'',text:'{"tool_name":"gmail.get_profile"}'},specs);
  assert.equal(profile.path,'gmail.get_profile');assert.equal(profile.text,'{}');
  // 파일 이름 인자를 도구 이름으로 착각하지 않음
  const file=normalizeServiceCall({path:'',text:'{"path":"image.png"}'},[{name:'files.info',inputSchema:{type:'object',properties:{path:{}}}}]);
  assert.equal(file.path,'files.info');assert.deepEqual(JSON.parse(file.text),{path:'image.png'});
});

test('the exact failing call from the log (junk tail, empty path) is sent to Gmail after one search',async()=>{
  const sent=[];let turn=0;
  const text=String.raw`{"to":"me","subject":"바탕화면 녹화 영상","body":"요청하신 영상입니다.","files":["C:\Users\User\Desktop\desktop_record.mp4"]}","path":"gmail.send_attached_email"`;
  const steps=[{tool:'plugin_search',text:'gmail',path:'',thought:''},{tool:'plugin_call',text,path:'',thought:''},{tool:'reply',text:'보냈습니다. 메시지 ID abc',path:'',thought:''}];
  await runAgentLoop({input:'녹화 파일 지메일로 나한테 보내',settings:{noSpec:true,manualHandoff:false},maxSteps:6,context:{},
    chat:async(m,f)=>f?.properties?.verified||f?.properties?.checks?verdict:JSON.stringify(steps[Math.min(turn++,steps.length-1)]),
    execute:async a=>{sent.push(a);return a.tool==='plugin_search'?sendSpec:'메시지 ID abc';}});
  const call=sent.find(a=>a.tool==='plugin_call');
  assert.equal(call?.path,'gmail.send_attached_email',JSON.stringify(sent.map(a=>a.tool+':'+a.path)));
  assert.equal(JSON.parse(call.text).files[0],String.raw`C:\Users\User\Desktop\desktop_record.mp4`);
});
