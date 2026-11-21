import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
const exec=promisify(execFile);

test('subscription CLI preserves long code, roles and uses prompt-file transport', {skip:process.platform!=='win32'}, async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'gemini-cli-transport-'));
 const oldPath=process.env.PATH,oldCapture=process.env.GEMINI_FIXTURE_CAPTURE;
 t.after(async()=>{process.env.PATH=oldPath;if(oldCapture===undefined)delete process.env.GEMINI_FIXTURE_CAPTURE;else process.env.GEMINI_FIXTURE_CAPTURE=oldCapture;await fs.rm(dir,{recursive:true,force:true});});
 const source=path.join(dir,'FakeAgy.cs'),exe=path.join(dir,'agy.exe'),capture=path.join(dir,'capture.json');
 await fs.writeFile(source,`using System;using System.IO;using System.Collections.Generic;using System.Web.Script.Serialization;
 public class FakeAgy {public static void Main(string[] args){
 var p=Array.IndexOf(args,"-p");var value=args[p+1];var prefix="Read the complete request in @";var file=value.StartsWith(prefix)?value.Substring(prefix.Length):null;
 var prompt=file==null?value:File.ReadAllText(file);
 var imageFiles=new List<string>();var imageBytes=new List<string>();
 foreach(System.Text.RegularExpressions.Match match in System.Text.RegularExpressions.Regex.Matches(prompt,@"(?m)\\] @([^\\r\\n]+)$")){var image=match.Groups[1].Value;imageFiles.Add(image);imageBytes.Add(Convert.ToBase64String(File.ReadAllBytes(image)));}
 var data=new Dictionary<string,object>{{"argument",value},{"promptFile",file},{"prompt",prompt},{"images",imageBytes},{"imageFiles",imageFiles},{"model",Array.IndexOf(args,"--model")>=0?args[Array.IndexOf(args,"--model")+1]:""},{"schemaExists",File.Exists(args[Array.IndexOf(args,"--json-schema")+1])}};
 File.WriteAllText(Environment.GetEnvironmentVariable("GEMINI_FIXTURE_CAPTURE"),new JavaScriptSerializer().Serialize(data));
 Console.WriteLine("{\\"status\\":\\"SUCCESS\\",\\"structured_output\\":{\\"answer\\":\\"ok\\"}}");
 }}`);
 await exec(path.join(process.env.WINDIR,'Microsoft.NET','Framework64','v4.0.30319','csc.exe'),['/nologo','/r:System.Web.Extensions.dll','/out:'+exe,source],{windowsHide:true});
 await fs.copyFile(new URL('../gemini-account.mjs',import.meta.url),path.join(dir,'gemini-account.mjs'));
 await fs.copyFile(new URL('../gemini-session.mjs',import.meta.url),path.join(dir,'gemini-session.mjs'));
 await fs.copyFile(new URL('../model-process-lifecycle.mjs',import.meta.url),path.join(dir,'model-process-lifecycle.mjs'));
 await fs.copyFile(new URL('../gemini-quota.mjs',import.meta.url),path.join(dir,'gemini-quota.mjs'));
 await fs.copyFile(new URL('../app-data.mjs',import.meta.url),path.join(dir,'app-data.mjs'));
 // This test exercises the one-shot long-prompt transport, not the streaming session.
 await fs.writeFile(path.join(dir,'제미나이설정.json'),JSON.stringify({session:false,model:'fixture-3.1-pro'}));
 await fs.writeFile(path.join(dir,'cloud-brain.mjs'),'export function extractJson(s){try{return JSON.parse(s)}catch{return null}}');
 process.env.PATH=dir+path.delimiter+oldPath;process.env.GEMINI_FIXTURE_CAPTURE=capture;
 const client=await import(pathToFileURL(path.join(dir,'gemini-account.mjs')));
 const beginning='IMPORTANT_USER_REQUIREMENT_START',ending='LAST_CODE_LINE_END';
 const long=beginning+'\n'+ 'function example(){return 123;}\n'.repeat(2300)+ending;
 const result=await client.complete([{role:'system',content:'SYSTEM_RULE'},{role:'user',content:long,keep:true},{role:'assistant',content:'PREVIOUS_ASSISTANT_REPLY'},{role:'user',content:'FINAL_REVIEW_REQUEST'}],null);
 assert.equal(result,'ok');
 const actual=JSON.parse(await fs.readFile(capture,'utf8'));
 assert.equal(actual.model,'fixture-3.1-pro');
 assert.ok(actual.promptFile,'long request should be passed as a file');
 assert.equal(actual.schemaExists,true);
 assert.ok(actual.prompt.includes(long),'entire long code must survive without silent prefix truncation');
 assert.ok(actual.prompt.includes('[SYSTEM INSTRUCTIONS]\nSYSTEM_RULE'));
 assert.ok(actual.prompt.includes('[YOU (previous)]\nPREVIOUS_ASSISTANT_REPLY'));
 assert.ok(actual.prompt.includes('[USER/TOOL RESULT]\nFINAL_REVIEW_REQUEST'));
 assert.deepEqual(actual.images,[],'headless transport remains text-only; images use ACP');
 await assert.rejects(()=>fs.stat(actual.promptFile),{code:'ENOENT'});
 for(const failing of ['prompt','schema'])await t.test('partial '+failing+' write removes every temporary request file',async t=>{
  const created=[],write=fs.writeFile;
  t.after(async()=>{for(const file of created)await fs.unlink(file).catch(()=>{});});
  t.mock.method(fs,'writeFile',async(file,...args)=>{
   if(/^gemma-(?:image|prompt|schema)-/.test(path.basename(String(file))))created.push(String(file));
   if(path.basename(String(file)).startsWith('gemma-'+failing+'-')){
    await write(file,'partial write');
    throw Object.assign(Error('injected '+failing+' write failure'),{code:'EIO'});
   }
   return write(file,...args);
  });
  await assert.rejects(()=>client.complete([{role:'user',content:'Inspect this text reference'}],null),new RegExp('injected '+failing+' write failure'));
  assert.ok(created.some(file=>path.basename(file).startsWith('gemma-'+failing+'-')));
  for(const file of created)await assert.rejects(()=>fs.stat(file),{code:'ENOENT'},'failed request must remove its partial '+path.basename(file));
 });
});
