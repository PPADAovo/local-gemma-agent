import test from 'node:test';
import assert from 'node:assert/strict';
import {ADAPTERS,adapterFor,adaptersMentioned,adapterNote,runAppScript} from '../app-adapters/index.mjs';
import {checkFreecadCode} from '../app-adapters/freecad.mjs';

test('every adapter is thin: id, name, language, match, detect, check, run — and has a usage note',async()=>{
 for(const a of ADAPTERS){
  for(const key of ['id','name','language'])assert.equal(typeof a[key],'string',a.id+'.'+key);
  assert.ok(a.match instanceof RegExp);
  for(const fn of ['detect','check','run'])assert.equal(typeof a[fn],'function',a.id+'.'+fn);
  assert.ok((await adapterNote(a.id)).length>100,a.id+' note');
 }
});
test('apps are found by id or name; apps without an adapter are sent to screen control',async()=>{
 assert.equal(adapterFor('blender')?.id,'blender');assert.equal(adapterFor('블렌더')?.id,'blender');
 assert.equal(adapterFor('FreeCAD')?.id,'freecad');assert.equal(adapterFor('메모장'),null);
 assert.deepEqual(adaptersMentioned('블렌더로 의자 만들어줘').map(a=>a.id),['blender']);
 await assert.rejects(runAppScript({app:'mspaint',code:'x',name:'n',outDir:'.'}),/화면 조작/);
});
test('FreeCAD code is limited to building shapes in the document',()=>{
 assert.equal(checkFreecadCode('b=Part.makeBox(10,20,5)\ndoc.addObject("Part::Feature","받침").Shape=b'),'');
 for(const bad of ['import os','doc.saveAs("C:/x.FCStd")','App.openDocument("x")','open("x","w")','import Import\nImport.export([],"x.step")'])
  assert.notEqual(checkFreecadCode(bad),'',bad);
});
