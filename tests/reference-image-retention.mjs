import test from 'node:test';
import assert from 'node:assert/strict';
import {runSimpleLoop} from '../simple-loop.mjs';

test('design reference stays visible while old screen captures are replaced after input',async()=>{
  const reference='cmVmZXJlbmNl';let step=0,looks=0;
  const frame={imageWidth:100,imageHeight:100,left:0,top:0,width:100,height:100,elements:[{id:1,name:'편집',x:20,y:20}],window:{handle:1,pid:2,rect:[0,0,100,100]}};
  const call=(name,args={})=>({tool_calls:[{function:{name,arguments:args}}]});
  const result=await runSimpleLoop({input:'첨부한 참고 이미지처럼 편집해 주세요',images:[reference],
    chatMessage:async({messages})=>{
      step++;
      assert.deepEqual(messages.find(m=>m.role==='user'&&m.content==='첨부한 참고 이미지처럼 편집해 주세요').images,[reference]);
      if(step===1)return call('look');
      if(step===2)return call('click',{target:'E1'});
      const screens=messages.flatMap(m=>m.images||[]).filter(image=>image!==reference);
      assert.deepEqual(screens,['screen-2']);
      return {content:'수정한 화면을 확인했습니다.'};
    },execute:async a=>a.tool==='look'?{...frame,image:'screen-'+(++looks)}:{ok:true}});
  assert.equal(result.complete,true);assert.equal(looks,2);
});
