import assert from 'node:assert/strict';
import test from 'node:test';
import {runAgentLoop} from '../agent-loop.mjs';

test('120 changing scroll results survive compaction; old evidence is retrieved without repeating the action',async()=>{
  let scrolls=0, readOld=false, retried=false, compactions=0;
  const request='웹 목록을 스크롤해서 확인해 줘';
  const result=await runAgentLoop({
    // 2026-11-14 정리: 브라우저 도구(browser_*)는 개인 브라우저 모드에서만 제공되므로 그 모드로 실행합니다.
    input:request,settings:{noSpec:true,computerUse:false,privateBrowser:true},context:{},maxSteps:5,
    chat:async(messages,schema)=>{
      if(schema.properties.verified)return JSON.stringify({verified:true,quote:'페이지: 목록',gap:''});
      assert.ok(messages.some(m=>m.content===request));
      assert.ok(messages.length<40);
      if(messages.some(m=>m.content.startsWith('Resume this same task')))compactions++;
      if(scrolls===46 && !retried){retried=true;throw new DOMException('timeout','TimeoutError');}
      if(scrolls<120)return JSON.stringify({tool:'browser_scroll',text:'down'});
      if(!readOld){readOld=true;return JSON.stringify({tool:'review_result',text:'1',path:'5000'});}
      assert.match(messages.at(-1).content,/first-page-only/);
      return JSON.stringify({tool:'reply',text:'120페이지를 확인했습니다.'});
    },
    execute:async action=>{
      assert.equal(action.tool,'browser_scroll');
      scrolls++;
      return '페이지: 목록\n주소: https://example.test/list\n'+'x'.repeat(5100)+(scrolls===1?'first-page-only':'')+'\n스크롤 '+scrolls;
    }
  });
  assert.equal(result.complete,true);
  assert.equal(scrolls,120);
  assert.ok(compactions>0 && retried);
});
