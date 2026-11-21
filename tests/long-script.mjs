import test from 'node:test';
import assert from 'node:assert/strict';
import {generateLongScript} from '../long-script.mjs';

// Distinct printable text for deterministic size, overlap and truncation checks.
function passage(length, seed) {
  let value = seed;
  let text = '';
  for (let i = 0; i < length - 1; i++) {
    value = (Math.imul(1664525, value) + 1013904223) >>> 0;
    text += String.fromCharCode(0xAC00 + (value % 11172));
  }
  return text + '.';
}

test('timed multi-part request passes sources, pictures, prior dialogue and preceding passages', async () => {
  const chunks = [];
  const progress = [];
  const result = await generateLongScript({
    minutes: 8, input: '이어서 방송 대본을 작성해 줘.', recent: [{role:'user',content:'주제는 온실이야.'}],
    sources: '첫 촬영 장면은 유리 온실이다.', images: ['image-base64'],
    progress: line => progress.push(line),
    generate: async ({messages, maxTokens, format}) => {
      assert.ok(messages.some(m => m.content.includes('주제는 온실이야.')));
      assert.ok(messages.some(m => m.content.includes('유리 온실') && m.images?.[0] === 'image-base64'));
      if (format === 'json') return JSON.stringify({sections:[
        {scope:'온실 도착',quote:'유리 온실'}, {scope:'첫 촬영',quote:'첫 촬영'}, {scope:'퇴장',quote:'미확인 인용'}
      ]});
      const prompt = messages.at(-1).content;
      assert.ok(prompt.includes(['온실 도착 — 원문: 유리 온실','첫 촬영 — 원문: 첫 촬영','퇴장'][chunks.length]));
      assert.ok(!prompt.includes('미확인 인용'));
      if(!chunks.length) assert.match(prompt,/첫 문장부터 요청한 실제 이름/u);
      if (chunks.length) assert.ok(prompt.includes(chunks.at(-1)));
      const size = Number(prompt.match(/부분을 약 (\d+)자/u)[1]);
      assert.ok(maxTokens >= size);
      chunks.push(passage(size, chunks.length+1));
      return chunks.at(-1);
    }
  });
  assert.equal(result.complete, true);
  assert.equal(result.targetChars, 2400);
  assert.equal(chunks.length, 3);
  assert.equal(progress.length, 4);
  assert.equal(result.answer, chunks.join('\n\n'));
});

test('character count overrides duration, rejects an outline and duplicated text', async () => {
  const good = passage(820, 42);
  const outputs = ['목차:\n도입: ' + good, good, good, passage(820, 13)];
  const result = await generateLongScript({
    input:'1,600자 분량의 한국어 대본', minutes: 30, generate: ({format}) => format ? '{}' : outputs.shift()
  });
  assert.equal(result.targetChars, 1600);
  assert.ok(result.complete);
  assert.equal(result.answer, good + '\n\n' + passage(820,13));
  assert.equal(outputs.length, 0);
});

test('short, internally repetitive and incomplete responses stop after bounded retries', async () => {
  for (const [response,expected] of [
    ['네.', ''], ['이 문장을 다시 읽어보세요. '.repeat(75),''],
    [passage(200,1),passage(200,1)], [passage(310,3).slice(0,-1)+'하',passage(310,3).slice(0,-1)+'하']
  ]) {
    let calls = 0;
    const r = await generateLongScript({input:'300자 대본 작성', generate:()=>{calls++; return response;}});
    assert.equal(r.complete, false);
    assert.equal(r.answer,expected);
    assert.ok(r.reason.length > 0);
    assert.equal(calls, 3);
  }
});

test('model failure after valid work preserves the usable partial script', async () => {
  let calls=0;
  const first=passage(800,17);
  const r=await generateLongScript({input:'대본',minutes:5,generate:({format})=>{
    if(format) throw new Error('JSON unavailable');
    if(calls++) throw new Error('provider disconnected');
    return first;
  }});
  assert.equal(r.complete,false);
  assert.equal(r.answer,first);
  assert.match(r.reason,/모델/u);
});

test('early overshoot still requests a closing passage and returns only its body', async () => {
  const start = passage(1250, 7);
  const end = passage(202, 90);
  const outputs = [start, '아래는 요청하신 대본입니다.\n' + end];
  const r = await generateLongScript({input:'1,200자 대본',generate:({format})=>format ? 'invalid JSON' : outputs.shift()});
  assert.equal(r.complete, true);
  assert.equal(r.answer, start + '\n\n' + end);
});

test('resume keeps the prior script verbatim even when it is already at the length target', async () => {
  const draft = passage(650,31);
  const ending = passage(210,12);
  let calls = 0;
  const r = await generateLongScript({input:'600자 지도 소개 대본',initialAnswer:draft,generate:({messages})=>{
    calls++;
    const prompt=messages.at(-1).content;
    assert.ok(prompt.includes(draft));
    assert.match(prompt,/완결된 문장/u);
    return ending;
  }});
  assert.ok(r.complete);
  assert.equal(r.answer,draft+'\n\n'+ending);
  assert.equal(calls,1);
});

test('factual map scripts retry a fabricated numeric mechanic', async () => {
  const legitimate = '이 지도에서는 보상이 15퍼센트 늘어납니다. ' + passage(300,50);
  const outputs = ['여기서는 보상이 5% 늘어납니다. ' + passage(300,41), legitimate];
  const result = await generateLongScript({
    input:'300자 지도 소개 대본', sources:'이벤트 보상은 15% 추가됩니다.', generate:()=>outputs.shift()
  });
  assert.ok(result.complete);
  assert.equal(result.answer,legitimate);
});
