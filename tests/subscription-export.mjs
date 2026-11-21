import assert from 'node:assert/strict';
import test from 'node:test';
import {collectSubscriptions,subscriptionCsv} from '../subscription-export.mjs';
const line=n=>'채널 '+n+' @c'+n+'•구독자 3명 https://www.youtube.com/@c'+n;
test('load more items after first reaching bottom and include nonsampled rows in order',async()=>{
 const pages=[[0,[1,2]],[54,[2,3]],[100,[3,4]],[80,[4,5]],[100,[5,6]]];
 let tick=0;
 const rows=await collectSubscriptions(async cmd=>{
   if(cmd==='scroll')tick++;
   const [position,ids]=pages[Math.min(tick,pages.length-1)];
   return {state:'ready',position,rows:ids.map(line)};
 },()=>{},async()=>{});
 assert.deepEqual(rows.map(r=>r.name),[1,2,3,4,5,6].map(n=>'채널 '+n));
 assert.ok(tick>=7);
 const csv=subscriptionCsv(rows,new Map([[rows[0].url,'영상 "A", 1']]));
 assert.equal(csv.trimEnd().split('\r\n').length,7);
 assert.match(csv,/영상 ""A"", 1/);
});
test('unknown or stalled positions cannot prove collection complete',async()=>{
 for(const position of ['unknown',54]){
 await assert.rejects(collectSubscriptions(async()=>({state:'ready',position,rows:[line(1)]}),()=>{},async()=>{}),/끝/);
 }
});
