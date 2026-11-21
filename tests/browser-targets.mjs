import assert from 'node:assert/strict';
import test from 'node:test';
process.env.AGENT_BROWSER_PORT='9333'; // mock CDP endpoint
const {browser}=await import('../browser.mjs');

function page(id) {
  return {id, type:'page', url:'https://example.test/'+id, webSocketDebuggerUrl:'ws://127.0.0.1/'+id};
}

test('web controls keep their page, inspect SPA results and follow only a new child tab', async t=>{
  let pages=[page('search'), page('unrelated')];
  let focused='search',childMode=false,ignoreKey=false,keyTime=0,typed='',keyPresses=0,childUrlChecks=0;
  const snapshots=[];
  const resultVisible=()=>keyTime!==0 && Date.now()-keyTime>550;
  t.mock.method(globalThis,'fetch',async url=>{
    const route=new URL(url).pathname;
    if(route==='/json/version')return Response.json({Browser:'Test'});
    if(route==='/json/list')return Response.json(pages);
    throw Error('Unexpected URL: '+route);
  });
  const original=globalThis.WebSocket;
  class Socket extends EventTarget {
    constructor(url){super();this.page=new URL(url).pathname.slice(1);queueMicrotask(()=>this.dispatchEvent(new Event('open')));}
    send(packet){
      const {id,method,params}=JSON.parse(packet);
      let result={};
      if(method==='Runtime.evaluate'){
        const script=params.expression;
        let value;
        if(script.includes('const out=[];let n=0')){
          snapshots.push(this.page);
          value={title:this.page,url:'https://example.test/'+this.page,elements:['B3 [input:text] 검색'],text:resultVisible()?'새로운 검색 결과':'검색'};
        }else if(script.includes('document.body?.innerText'))value=resultVisible()?'새로운 검색 결과':'검색';
        else if(script==='document.readyState')value='complete';
        else if(script==='location.href')value=++childUrlChecks===1?'about:blank':'https://example.test/result';
        else if(script.includes('el.focus()')){focused=this.page;value=true;}
        else if(script.includes('el.value:el.textContent'))value=typed;
        else throw Error('Unexpected evaluator.');
        result={result:{value}};
      }else if(method==='Input.insertText')typed=params.text;
      else if(method==='Input.dispatchKeyEvent' && params.type==='keyDown'){
        if(!ignoreKey)keyTime=Date.now();
        keyPresses++;
        if(childMode)pages=[page('unrelated'),page('result'),page('search')];
      }else if(method==='Target.getTargets'){
        result={targetInfos:pages.map(p=>({targetId:p.id,type:p.type,openerId:p.id==='result'?'search':undefined}))};
      }
      queueMicrotask(()=>this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({id,result})})));
    }
    close(){this.dispatchEvent(new Event('close'));}
  }
  globalThis.WebSocket=Socket;
  t.after(()=>{globalThis.WebSocket=original;});
  await browser({tool:'browser_read'});
  pages.reverse();
  await assert.rejects(browser({tool:'browser_type',target:'E7',text:'query'}),/B3 \[input:text\] 검색/);
  assert.match(await browser({tool:'browser_type',target:'B3',text:'query'}),/query/);
  assert.match(await browser({tool:'browser_type',path:'#b3',text:'query'}),/query/);
  assert.equal(focused,'search');
  assert.match(await browser({tool:'browser_key',text:'enter'}),/새로운 검색 결과/);
  assert.equal(keyPresses,1);
  ignoreKey=true;
  assert.match(await browser({tool:'browser_key',text:'enter'}),/변화를 확인하지 못했습니다/);
  assert.equal(keyPresses,2);
  childMode=true;
  assert.match(await browser({tool:'browser_key',text:'enter'}),/열린 새 탭/);
  await browser({tool:'browser_read'});
  assert.equal(snapshots.at(-1),'result');
  assert.ok(childUrlChecks>=2);
  pages=[page('unrelated')];
  await assert.rejects(browser({tool:'browser_type',target:'B3',text:'query'}),/탭이 닫혔습니다/);
});
