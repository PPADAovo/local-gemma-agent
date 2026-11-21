import {chat} from './cloud-brain.mjs';
const provider=process.argv[2];
if(!['gemini','gpt','claude'].includes(provider))process.exit(2);
try{
  const result=await chat([{role:'user',content:'Reply with OK.'}],{provider});
  if(!result.text.trim())throw Error('Empty');
  console.log(result.model);
}catch(e){
  console.error(/401|403|권한|키가 맞지/.test(e.message)?'API 키 또는 모델 접근 권한을 확인하세요.':/429|한도/.test(e.message)?'API 사용 한도 또는 잔액을 확인하세요.':'모델 설정, 네트워크 또는 API 결제 상태를 확인하세요.');
  process.exitCode=1;
}
