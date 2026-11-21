import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import * as windowsAgent from '../windows-agent.mjs';

test('known app selection refuses multiple running instances',()=>{
  assert.equal(typeof windowsAgent.selectUniqueInstalledApp,'function');
  const first={Id:10,ProcessName:'CalculatorApp'};
  assert.equal(windowsAgent.selectUniqueInstalledApp([]),null);
  assert.equal(windowsAgent.selectUniqueInstalledApp([first]),first);
  assert.throws(()=>windowsAgent.selectUniqueInstalledApp([first,{...first,Id:20}]),/여러|multiple/i);
});

// Execute only the production selection expression with a synthetic process
// inventory. Never run the update scripts, Stop-Process, or a real process query.
for(const file of ['update.ps1','swap.ps1'])test(`${file} selects only the current installation`,{skip:process.platform!=='win32'},async()=>{
  const source=await fs.readFile(new URL('../'+file,import.meta.url),'utf8');
  const lines=source.split(/\r?\n/);
  const setup=String.raw`$ProgressPreference='SilentlyContinue'; $dir='C:\fixture\current'; $target=Join-Path $dir '로컬 Gemma.exe'
function Get-Process {
  @([pscustomobject]@{Id=1;Path='C:\fixture\current\로컬 Gemma.exe'},
    [pscustomobject]@{Id=2;Path='C:\fixture\other\로컬 Gemma.exe'},
    [pscustomobject]@{Id=3;Path='C:\fixture\current\LocalGemma-build.exe'},
    [pscustomobject]@{Id=4;Path='C:\fixture\other\LocalGemma-build.exe'},
    [pscustomobject]@{Id=5;Path=$null})
}`;
  let selection;
  if(file==='update.ps1'){
    selection=lines.find(line=>line.startsWith('$running='))+'\n@(& $running).Id';
  }else{
    const declarations=lines.filter(line=>line.startsWith('$names=')||line.startsWith('$targets=')).join('\n');
    const pipeline=lines.find(line=>line.startsWith('Get-Process |')).split(' | Stop-Process')[0];
    selection=declarations+'\n@('+pipeline+').Id';
  }
  const encoded=Buffer.from(setup+'\n'+selection,'utf16le').toString('base64');
  const output=execFileSync('powershell.exe',['-NoProfile','-EncodedCommand',encoded],{encoding:'utf8',windowsHide:true});
  assert.deepEqual(output.trim().split(/\s+/).map(Number),file==='update.ps1'?[1]:[1,3]);
});
