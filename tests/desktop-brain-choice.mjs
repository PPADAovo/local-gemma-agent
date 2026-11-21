import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';

test('desktop provider selection clears stale fallback and preference merge preserves other active settings',{skip:process.platform!=='win32',timeout:20000},async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'gemma-brain-choice-'));
  try{
    const source=await fs.readFile(new URL('../DesktopPreferences.cs',import.meta.url),'utf8');
    const prefs=source.match(/    public class Prefs \{[\s\S]*?\n    \}/)?.[0];assert.ok(prefs);
    const menu=await fs.readFile(new URL('../DesktopModels.cs',import.meta.url),'utf8');
    const choice=menu.match(/Action<string> choose=key=>\{([\s\S]*?)SavePreferences\(\)/)?.[1];assert.ok(choice);
    const harness=`using System;using System.Web.Script.Serialization;using System.Collections.Generic;
class DesktopChat {${prefs}}
class Program {static void Select(DesktopChat.Prefs prefs,string key){${choice}}static void Check(bool ok,string why){if(!ok)throw new Exception(why);}static void Main(){
var json=new JavaScriptSerializer();var p=new DesktopChat.Prefs();p.brain="sub-claude";p.fallbackBrain="sub-gemini";
var before=json.Serialize(p);var latest=json.Deserialize<Dictionary<string,object>>(before);latest["externalFallback"]="sub-gemini";latest["instructions"]="another window changed this";latest["toolAllow"]=new[]{"read"};
Select(p,"local");var merged=DesktopIntegrity.MergePreferences(before,json.Serialize(p),json.Serialize(latest));var selected=json.Deserialize<Dictionary<string,object>>(merged);
Check((string)selected["brain"]=="local","local selected");Check(selected["fallbackBrain"]==null,"stale fallback cleared");Check(selected["externalFallback"] is bool && !(bool)selected["externalFallback"],"external fallback disabled");Check((string)selected["instructions"]=="another window changed this","concurrent setting preserved");Check(selected.ContainsKey("toolAllow"),"active profile preserved");
p=json.Deserialize<DesktopChat.Prefs>(merged);before=json.Serialize(p);Select(p,"sub-claude");merged=DesktopIntegrity.MergePreferences(before,json.Serialize(p),merged);selected=json.Deserialize<Dictionary<string,object>>(merged);
Check((string)selected["externalFallback"]=="sub-claude","new provider enabled");Check(selected["fallbackBrain"]==null,"old provider not restored");Check(selected["localFirst"]==null || (bool)selected["localFirst"],"local first default retained");Console.WriteLine("PASS");}}
`;
    const file=path.join(root,'Harness.cs'),exe=path.join(root,'Harness.exe');await fs.writeFile(file,harness);
    const csc=path.join(process.env.WINDIR,'Microsoft.NET','Framework64','v4.0.30319','csc.exe'),run=promisify(execFile);
    await run(csc,['/nologo','/codepage:65001','/out:'+exe,'/r:System.Web.Extensions.dll',file,fileURLToPath(new URL('../DesktopIntegrity.cs',import.meta.url))],{windowsHide:true,timeout:10000});
    const result=await run(exe,[],{windowsHide:true,timeout:5000});assert.match(result.stdout,/PASS/);
  }finally{assert.equal(path.dirname(root),os.tmpdir().replace(/[\\/]$/,''));await fs.rm(root,{recursive:true,force:true});}
});
