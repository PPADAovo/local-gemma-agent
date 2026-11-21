import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createConversation} from '../conversation.mjs';

test('photo questions send all pixels without opening the desktop', async t=>{
  const photos=['first-image','second-image'];
  const question='이 두 사진의 차이는 뭐야?';
  const files={
    list:['open_file.png','사진 뷰어 열어줘.png'].map(name=>({name,path:name,kind:'image'})),
    context:'첨부 파일 2개',
    images:photos
  };
  let calls=0;
  t.mock.method(globalThis,'fetch',async (_url,options)=>{
    const payload=JSON.parse(options.body);
    const user=payload.messages.at(-1);
    calls++;
    if(payload.format){
      assert.equal(user.content,question);
      assert.equal(user.images,undefined);
      return Response.json({message:{content:JSON.stringify({actionQuote:''})}});
    }
    assert.deepEqual(user.images,photos);
    assert.equal(JSON.parse(user.content).request,question);
    return Response.json({message:{content:'두 사진의 비교 결과'}});
  });
  const session=createConversation({files,endpoint:'http://localhost',execute:()=>assert.fail('unexpected desktop action')});
  const result=await session.ask(question);
  assert.equal(result.answer,'두 사진의 비교 결과');
  assert.deepEqual(result.events,[]);
  assert.equal(calls,2);
});

test('failed image decoding cannot fall back to a viewer or a screen capture',async ()=>{
  const files={list:[{name:'broken.heic',kind:'image'}],images:[],context:'내용 읽기 실패'};
  const session=createConversation({files,execute:()=>assert.fail('unexpected desktop action')});
  const result=await session.ask('사진을 설명해줘');
  assert.match(result.answer,/읽지 못했습니다/);
  assert.deepEqual(result.events,[]);
});
