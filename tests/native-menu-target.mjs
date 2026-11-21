import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';

test('pointer guard accepts only a native menu owned by the observed foreground',{skip:process.platform!=='win32'},async()=>{
  const source=await fs.readFile(new URL('../computer.ps1',import.meta.url),'utf8');
  const guard=source.match(/^function Assert-PointerTarget\([^]*?^\}/m)?.[0];
  const check=source.match(/^function Check-Point\([^]*?^\}/m)?.[0];
  assert.ok(guard,'Owned-menu validation missing');assert.ok(check);
  const script=String.raw`$ProgressPreference='SilentlyContinue'
Add-Type -AssemblyName System.Drawing
`+guard+String.raw`
$observed=@{handle=7;pid=12;class='App';owner=0}
$cases=@(
 @{hit=@{handle=7;pid=12;class='App';owner=0};foreground=7},
 @{hit=@{handle=9;pid=12;class='#32768';owner=7};foreground=7},
 @{hit=@{handle=9;pid=12;class='#32770';owner=7};foreground=7},
 @{hit=@{handle=9;pid=12;class='#32768';owner=88};foreground=7},
 @{hit=@{handle=9;pid=99;class='#32768';owner=7};foreground=7},
 @{hit=@{handle=9;pid=12;class='#32768';owner=7};foreground=44},
 @{hit=@{handle=9;pid=12;class='#32768';owner=0};foreground=7}
)
foreach($case in $cases){try{Assert-PointerTarget $observed $case.hit $case.foreground;'accepted'}catch{'rejected'}}
Add-Type 'public class FakeNative { public static System.IntPtr WindowFromPoint(System.Drawing.Point p){return new System.IntPtr(9);} public static System.IntPtr GetAncestor(System.IntPtr h,uint flags){return h;} public static System.IntPtr GetForegroundWindow(){return new System.IntPtr(7);} }' -ReferencedAssemblies System.Drawing
function Window-Info($h){if($h.ToInt64() -eq 7){return $observed};return @{handle=9;pid=12;class='#32768';owner=7}}
function In-Selection($h){return $true}
function Check-App($h){}
`+check.replaceAll('[AgentInput]','[FakeNative]')+String.raw`
$req=@{observedHandle=7;selectedHandle=7;selectedPid=12}
Check-Point 100 200
'dispatch accepted'
`;
  const output=execFileSync('powershell.exe',['-NoProfile','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,encoding:'utf8'});
  assert.deepEqual(output.trim().split(/\r?\n/),['accepted','accepted','rejected','rejected','rejected','rejected','rejected','dispatch accepted']);
});
