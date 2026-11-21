import test from 'node:test';
import assert from 'node:assert/strict';
import {fixKoreanTypo} from '../hangul-typo.mjs';
import {createConversation} from '../conversation.mjs';

test('Korean typed on the English layout is converted',()=>{
  assert.equal(fixKoreanTypo('ektltlehgownj'),'다시시도해줘');
  assert.equal(fixKoreanTypo('dkssudgktpdy'),'안녕하세요');
  assert.equal(fixKoreanTypo('tockdmfh dufdjwnj'),'새차으로 열어줘');
  assert.equal(fixKoreanTypo('dkfrpTdj'),'알겠어');
});

test('ordinary English, short words and mixed text are left alone',()=>{
  for(const text of ['hello','retry','ok','Transformer','test','gmail','api key','go','do','카카오톡 열어줘','send 3 files','https://example.com'])
    assert.equal(fixKoreanTypo(text),null,text);
});

test('a layout-typo retry reaches the retry path instead of the model guessing',async()=>{
  const progress=[];
  const session=createConversation({endpoint:'http://localhost',execute:()=>assert.fail('no tool'),progress:p=>progress.push(p),turns:[]});
  const result=await session.ask('ektltlehgownj');
  assert.match(progress.join('\n'),/한\/영 자판을 바꿔 읽었어요 · 다시시도해줘/);
  assert.equal(result.needsInput,true);
  assert.match(result.answer,/다시 실행할 요청/);
});

import {looksLikeTypo,koreanToQwerty} from '../hangul-typo.mjs';
import {runAgentLoop} from '../agent-loop.mjs';
import {listSkills} from '../skills.mjs';

test('typo-like input is detected, chat expressions are not',()=>{
  for(const t of ['ㅗ디ㅣㅐ','ㅎ걷ㄷ','qwrtpsd','ektltlehgownj'])assert.equal(looksLikeTypo(t),true,t);
  for(const t of ['hello','카카오톡 열어줘','ㅋㅋㅋ','ㅠㅠ','ㅇㅇ','ㄱㄱ 해줘'])assert.equal(looksLikeTypo(t),false,t);
  assert.equal(koreanToQwerty('ㅗ디ㅣㅐ'),'hello');
});

test('the typo-language skill exists and is read before anything else',async()=>{
  const skills=await listSkills();
  assert.ok(skills.some(s=>s.name==='typo-language'),'스킬 목록에 typo-language');
  const calls=[];
  await runAgentLoop({input:'[typo-language] ㅗ디ㅣㅐ\n\n(앱이 계산한 자판 변환 후보 · 한글 자판으로 친 영어라면: "hello")',
    settings:{noSpec:true,toolAllow:['skill','reply'],skills:[{name:'typo-language',description:'오타 판단'}]},context:{},maxSteps:3,
    chat:async(m,f)=>f?.properties?.verified?JSON.stringify({verified:true,quote:'',gap:''}):JSON.stringify({tool:'reply',text:'"hello"로 읽었어요.',path:'',thought:'판단'}),
    execute:async a=>{calls.push(a.tool+':'+a.text);return '오타 판단 설명서';}});
  assert.equal(calls[0],'skill:typo-language');
});
