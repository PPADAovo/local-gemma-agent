import test from 'node:test';import assert from 'node:assert/strict';import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {powerShellCommand} from '../executor-safety.mjs';
const run=promisify(execFile);
const execute=command=>run('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(powerShellCommand(command),'utf16le').toString('base64')],{windowsHide:true,timeout:10000});
test('PowerShell 5 fails on an earlier nonzero native command despite later output or native success',{skip:process.platform!=='win32'},async()=>{
 for(const command of ['cmd.exe /c exit 7; Write-Output "SHOULD_NOT_RUN"','cmd.exe /c exit 7; cmd.exe /c exit 0','function Invoke-Failure {cmd.exe /c exit 7}; Invoke-Failure; Write-Output "SHOULD_NOT_RUN"','$value = cmd.exe /c exit 7; Write-Output "SHOULD_NOT_RUN"','cmd.exe /c exit 7 | Out-Null; Write-Output "SHOULD_NOT_RUN"'])await assert.rejects(execute(command),error=>{assert.doesNotMatch(String(error.stdout),/SHOULD_NOT_RUN/);assert.match(String(error.stderr),/7/);return true;});
});
test('PowerShell instrumentation preserves successful pipelines, scriptblocks and handled exceptions',{skip:process.platform!=='win32'},async()=>{
 const cases=[['1,2,3 |\n ForEach-Object {$_ * 2}','2\r\n4\r\n6'],['function Sum {param($x) $x+2}; Sum 5','7'],['$x = $(1+2); Write-Output $x','3'],['try {throw "expected"} catch {Write-Output "handled"}','handled'],['cmd.exe /c exit 0; Write-Output "done"','done']];
 for(const [command,expected] of cases){const result=await execute(command);assert.equal(result.stdout.trim(),expected);}
});
test('an explicitly caught native failure does not poison later successful commands',{skip:process.platform!=='win32'},async()=>{
 const result=await execute('try { cmd.exe /c exit 7 } catch { Write-Output "handled" }; Write-Output "done"');assert.match(result.stdout,/handled/);assert.match(result.stdout,/done/);
});
test('PowerShell instrumentation preserves hashtable literals and nested collections',{skip:process.platform!=='win32'},async()=>{
 const result=await execute('$h=@{a=1;b=@{c=2}}; Write-Output ($h.a+$h.b.c)');assert.equal(result.stdout.trim(),'3');
});
