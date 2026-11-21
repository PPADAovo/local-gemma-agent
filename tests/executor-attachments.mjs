import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {prepareAttachments,readZip} from '../attachments.mjs';import {writeZip} from '../pptx.mjs';
test('backend rejects oversized folder attachments before copying or parsing',async()=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'gemma-attachment-test-'));
 try{const file=path.join(root,'oversized.bin'),handle=await fs.open(file,'w');await handle.truncate(2*1024**3+1);await handle.close();const result=await prepareAttachments([file],{workspace:path.join(root,'workspace')});assert.equal(result.list.length,0);assert.match(result.context,/2GB|2 GB/);}
 finally{assert.equal(path.dirname(root),os.tmpdir().replace(/[\\/]$/,''));await fs.rm(root,{recursive:true,force:true});}
});
test('ZIP extraction caps aggregate actual decoded bytes across selected entries',()=>{
 const archive=writeZip(new Map([['a.xml','a'.repeat(600)],['b.xml','b'.repeat(600)]]));
 assert.throws(()=>readZip(archive,()=>true,{maxDecodedBytes:1000}),/압축.*한도/);
 assert.equal(readZip(archive,name=>name==='a.xml',{maxDecodedBytes:1000}).files.get('a.xml').length,600);
 const misleading=Buffer.from(archive);let p=misleading.readUInt32LE(misleading.length-6);
 for(let i=0;i<2;i++){misleading.writeUInt32LE(1,p+24);p+=46+misleading.readUInt16LE(p+28);}
 assert.throws(()=>readZip(misleading,()=>true,{maxDecodedBytes:1000}),/압축.*한도/);
});
