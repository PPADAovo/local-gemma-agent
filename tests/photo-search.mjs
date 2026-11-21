import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {searchPhotos,savePhoto} from '../photo-search.mjs';

function page(id,index,overrides={}){
  return {pageid:id,index,ns:6,title:'File:Garden.jpg',imageinfo:[{
    mime:'image/jpeg',width:1000,height:800,
    thumburl:'https://thumb.wikimedia.org/test.jpg',descriptionurl:'https://commons.wikimedia.org/wiki/File:Garden.jpg',
    extmetadata:{LicenseShortName:{value:'CC BY 4.0'},LicenseUrl:{value:'https://creativecommons.org/licenses/by/4.0/'},Artist:{value:'<b>A &amp; B</b>'}},...overrides
  }]};
}
const api=pages=>Response.json({query:{pages}});

test('search keeps source attribution, checks license metadata and preserves relevance',async()=>{
  const cards=await searchPhotos('garden',{request:async url=>{
    assert.match(url.searchParams.get('gsrsearch'),/garden/);
    return api([page(1,2),page(3,1),page(4,3,{extmetadata:{}}),page(5,4,{mime:'text/html'})]);}});
  assert.deepEqual(cards.map(card=>card.id),['3','1']);
  assert.equal(cards[0].author,'A & B');assert.match(cards[0].sourceUrl,/commons\.wikimedia\.org/);
});

test('an incomplete download leaves no project file; saving again preserves an existing file',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'photo-search-test-'));
  const file=path.join(dir,'calendar.jpg');
  try{
    const request=async url=>String(url).includes('w/api.php')?api([page(7,1)]):new Response(Buffer.from([255,216,0,0]),{headers:{'Content-Type':'image/jpeg'}});
    await assert.rejects(savePhoto('7',file,{request}),/불완전/);
    assert.deepEqual(await fs.readdir(dir),[]);
    const complete=async url=>String(url).includes('w/api.php')?api([page(7,1)]):new Response(Buffer.from([255,216,255,217]),{headers:{'Content-Type':'image/jpeg'}});
    await fs.writeFile(file,'original');
    await assert.rejects(savePhoto('7',file,{request:complete}),{code:'EEXIST'});
    assert.equal(await fs.readFile(file,'utf8'),'original');
    assert.deepEqual(await fs.readdir(dir),['calendar.jpg']);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
