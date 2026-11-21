import test from 'node:test';
import assert from 'node:assert/strict';
import {findFreeTool,lookupEnglishWord,checkFreeToolPage} from '../free-tools.mjs';

test('checks the publisher before offering a connected service and keeps unknown tools as leads',async()=>{
  const requests=[];
  const request=async url=>{requests.push(String(url)); return new Response('ok');};
  const known=await findFreeTool('image-generation',{request});
  assert.equal(known.candidates[0].tool,'generate_image');
  assert.equal(requests.length,1);
  const down=await findFreeTool('image-generation',{request:async()=>new Response('',{status:503}),search:async()=>[]});
  assert.deepEqual(down.candidates,[]);
  const other=await findFreeTool('subtitle timing editor',{search:async()=>[{url:'https://example.com/',title:'Subtitle Editor'}]});
  assert.equal(other.candidates[0].status,'needs_review');
});

test('dictionary tool transmits only a lookup term and reads actual definitions',async()=>{
  const result=await lookupEnglishWord('meadow',async url=>{
    assert.equal(String(url),'https://api.dictionaryapi.dev/api/v2/entries/en/meadow');
    return Response.json([{word:'meadow',meanings:[{partOfSpeech:'noun',definitions:[{definition:'A field or pasture.'}]}]}]);
  });
  assert.equal(result.entries[0].definition,'A field or pasture.');
  await assert.rejects(lookupEnglishWord('https://example.org/'));
});

test('an unregistered website needs observed functional and free-use evidence',async()=>{
  const page={url:'https://example.com/',text:'Free online editor. Change subtitle timing.'};
  const chat=async()=>JSON.stringify({matches:true,freeQuote:'Free online editor',functionQuote:'Change subtitle timing'});
  assert.equal((await checkFreeToolPage(chat,'subtitle timing',page)).url,page.url);
  assert.equal(await checkFreeToolPage(chat,'subtitle timing',{...page,text:'Premium paid editor. Change subtitle timing.'}),null);
});
