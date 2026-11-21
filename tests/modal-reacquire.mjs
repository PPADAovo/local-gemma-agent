import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
test('reacquiring input preserves the observed owned modal instead of its main window',{skip:process.platform!=='win32'},async()=>{
  const source=await fs.readFile(new URL('../computer.ps1',import.meta.url),'utf8');
  const target=source.match(/^function Target-Window\{[^]*?^\}/m)?.[0];assert.ok(target);
  const script=String.raw`$ProgressPreference='SilentlyContinue'
Add-Type 'public class FakeWindow { public static System.IntPtr Foreground=new System.IntPtr(99); public static long Focused=0; public static System.IntPtr GetForegroundWindow(){return Foreground;} public static bool Focus(System.IntPtr h){Focused=h.ToInt64();Foreground=h;return true;} }'
function In-Selection($h){return @([long]7,[long]9) -contains $h.ToInt64()}
function Window-Info($h){@{handle=$h.ToInt64();pid=12;process='fixture'}}
function Blocked-Window($h){return $false}
function Self-Window($h){return $false}
function Check-App($h){}
`+target.replaceAll('[AgentInput]','[FakeWindow]')+String.raw`
$req=@{selectedHandle=7;selectedPid=12;observedHandle=9}
$window=Target-Window
Write-Output ('modal='+$window.ToInt64())
[FakeWindow]::Foreground=[IntPtr]99;[FakeWindow]::Focused=0
$req.observedHandle=88
try{[void](Target-Window);'invalid=accepted'}catch{'invalid=rejected'}
Write-Output ('invalidFocus='+[FakeWindow]::Focused)
`;
  const output=execFileSync('powershell.exe',['-NoProfile','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,encoding:'utf8'});
  assert.match(output,/modal=9/);assert.match(output,/invalid=rejected/);assert.match(output,/invalidFocus=0/);
});
