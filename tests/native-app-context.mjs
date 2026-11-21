import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';

// Execute the dependency-free context-selection statement from the real app
// launcher, without running its UI discovery or process-launching branches.
test('installed-app resolver honors a numeric local context setting',{skip:process.platform!=='win32'},async()=>{
  const source=await fs.readFile(new URL('../native-actions.ps1',import.meta.url),'utf8');
  const statement=source.split(/\r?\n/).find(line=>line.trim().startsWith('$ctx=if('));
  assert.ok(statement);
  for(const [value,expected] of [['8192',8192],['16384',16384],['bad',32768]]){
    const output=execFileSync('powershell.exe',['-NoProfile','-Command',statement+'; Write-Output $ctx'],{windowsHide:true,encoding:'utf8',env:{...process.env,LOCAL_AGENT_CTX:value}});
    assert.equal(Number(output.trim()),expected);
  }
});
