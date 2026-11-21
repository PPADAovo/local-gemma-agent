import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';

test('native capture rejects target or geometry changes during UIA/OCR',{skip:process.platform!=='win32'},async()=>{
  const source=await fs.readFile(new URL('../computer.ps1',import.meta.url),'utf8');
  const match=source.match(/^function Assert-ObservationCurrent\([^]*?^\}/m);
  assert.ok(match,'native capture must validate its beginning/end observation');
  // Execute just the pure guard copied from the production script. All windows
  // below are synthetic: no native imports, UI actions, captures, or process IO.
  const script=match[0]+String.raw`
$captured=@{handle=11;pid=22;rect=@(100,200,900,800)}
$cases=@(
  @{window=@{handle=11;pid=22;rect=@(100,200,900,800)};foreground=11},
  @{window=@{handle=11;pid=22;rect=@(120,200,920,800)};foreground=11},
  @{window=@{handle=11;pid=22;rect=@(100,200,1000,800)};foreground=11},
  @{window=@{handle=11;pid=99;rect=@(100,200,900,800)};foreground=11},
  @{window=@{handle=33;pid=22;rect=@(100,200,900,800)};foreground=33},
  @{window=@{handle=11;pid=22;rect=@(100,200,900,800)};foreground=44},
  @{window=@{handle=11;pid=22;rect=@()};foreground=11}
)
foreach($case in $cases){try{Assert-ObservationCurrent $captured $case.window $case.foreground;'accepted'}catch{'rejected'}}
`;
  const output=execFileSync('powershell.exe',['-NoProfile','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,encoding:'utf8'});
  assert.deepEqual(output.trim().split(/\s+/),['accepted','rejected','rejected','rejected','rejected','rejected','rejected']);
});
