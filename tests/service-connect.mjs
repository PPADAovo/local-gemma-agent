import test from 'node:test';
import assert from 'node:assert/strict';
import {findService,hasConnectedTools,connectionCard,guideConnection,CONNECT,ENABLE,DONE,SITE,STOP,EXTENSION} from '../service-connect.mjs';

const gmail=findService('지메일로 보내줘');
const notion=findService('노션에 정리해줘');

test('requests name the service they need',()=>{
  assert.equal(gmail.slug,'gmail');
  assert.equal(findService('구글 드라이브에서 찾아줘').slug,'google-drive');
  assert.equal(findService('아웃룩 메일 확인').slug,'outlook-email');
  assert.equal(findService('오늘 날씨 알려줘'),null);
});

test('connected tools are recognized, built-in shortcuts and local sites are not',()=>{
  assert.equal(hasConnectedTools(gmail,[{name:'gmail.send_email'}]),true);
  assert.equal(hasConnectedTools(gmail,['gmail','github']),true);
  assert.equal(hasConnectedTools(gmail,[{name:'gmail.send_attached_email',builtin:true},{name:'local.gmail.open'}]),false);
  assert.equal(hasConnectedTools(gmail,[]),false);
});

test('the first card offers the action that fits the real status',()=>{
  assert.deepEqual(connectionCard(gmail,{installed:true,enabled:false}).options,[ENABLE,SITE,STOP]);
  assert.deepEqual(connectionCard(gmail,{installed:false,enabled:false,url:'https://example.test/connect'}).options,[CONNECT,SITE,STOP]);
  // 안전하지 않은 주소는 연결 버튼으로 내보내지 않습니다.
  assert.deepEqual(connectionCard(gmail,{installed:false,url:'javascript:alert(1)'}).options,[SITE,STOP]);
  assert.deepEqual(connectionCard(notion,null).options,[STOP]);
});

test('connecting opens the provider page and succeeds only after a real recheck',async()=>{
  const opened=[],asked=[],enabled=[];let checks=0;
  const result=await guideConnection({service:gmail,
    getStatus:async()=>(++checks>=2?{installed:true,enabled:true,connected:true}:{installed:false,enabled:false,connected:false,url:'https://example.test/connect'}),
    ask:async card=>{asked.push(card.options);return card.options.includes(CONNECT)?CONNECT:DONE;},
    enable:async slug=>enabled.push(slug),
    openUrl:async url=>opened.push(url)});
  assert.deepEqual(result,{connected:true});
  assert.deepEqual(opened,['https://example.test/connect']);
  assert.deepEqual(enabled,['gmail']);
  assert.equal(asked.length,2);
});

test('a connection that never shows up stops instead of claiming success',async()=>{
  const result=await guideConnection({service:gmail,
    getStatus:async()=>({installed:false,enabled:false,connected:false,url:'https://example.test/connect'}),
    ask:async card=>card.options.includes(CONNECT)?CONNECT:DONE,openUrl:async()=>{}});
  assert.equal(result.stop,true);
  assert.match(result.message,/확인되지 않아/);
});

test('a disabled service is turned on only when the user presses the button',async()=>{
  const enabled=[];let on=false;
  const result=await guideConnection({service:gmail,
    getStatus:async()=>({installed:true,enabled:on,connected:on}),
    ask:async()=>ENABLE,enable:async slug=>{enabled.push(slug);on=true;},openUrl:async()=>{}});
  assert.deepEqual(enabled,['gmail']);
  assert.deepEqual(result,{connected:true});
});

test('choosing the site suggests the work tab extension when it is missing',async()=>{
  let setup=0;
  const result=await guideConnection({service:gmail,
    getStatus:async()=>({installed:false,enabled:false,connected:false,url:'https://example.test/connect'}),
    ask:async card=>card.options.includes(EXTENSION)?EXTENSION:SITE,openUrl:async()=>assert.fail('연결 화면을 열면 안 됩니다'),
    hasWorkTab:async()=>false,openExtensionSetup:async()=>{setup++;}});
  assert.equal(result.fallback,'local.gmail.open');
  assert.equal(setup,1);
});

test('stopping never opens anything',async()=>{
  const result=await guideConnection({service:gmail,
    getStatus:async()=>({installed:false,url:'https://example.test/connect'}),
    ask:async()=>STOP,openUrl:async()=>assert.fail('열면 안 됩니다'),enable:async()=>assert.fail('켜면 안 됩니다')});
  assert.equal(result.stop,true);
});

test('an already connected service skips the card',async()=>{
  const result=await guideConnection({service:gmail,getStatus:async()=>({installed:true,enabled:true,connected:true}),
    ask:async()=>assert.fail('카드를 띄우면 안 됩니다')});
  assert.deepEqual(result,{connected:true});
});
