import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const sameFile=(a,b)=>a&&b&&a.dev===b.dev&&a.ino===b.ino&&a.birthtimeMs===b.birthtimeMs;
const alive=pid=>{try{process.kill(pid,0);return true;}catch(error){return error.code!=='ESRCH';}};
async function snapshot(file){try{return {text:await fs.readFile(file,'utf8'),stat:await fs.stat(file)};}catch{return null;}}
// A stale Windows lease must remain open while it is checked and marked for deletion.
// Delete-pending prevents a replacement owner until all such read handles are closed.
const reclaimWindowsScript=`$ErrorActionPreference='Stop';$lease=$null;$lockPath=$env:GEMMA_PREF_LOCK_PATH;
try {
 $lease=[IO.FileStream]::new($lockPath,[IO.FileMode]::Open,[IO.FileAccess]::Read,([IO.FileShare]::Read -bor [IO.FileShare]::Delete));
 if($lease.Length -gt 32){return};
 $reader=[IO.StreamReader]::new($lease,[Text.Encoding]::UTF8,$true,64,$true);
 try {$value=$reader.ReadToEnd().Trim()} finally {$reader.Dispose()};
 $stale=$false;$lockOwnerPid=0;
 if($value.Length -eq 0){$stale=([DateTime]::UtcNow-[IO.File]::GetLastWriteTimeUtc($lockPath)).TotalSeconds -gt 60}
 elseif([int]::TryParse($value,[ref]$lockOwnerPid) -and $lockOwnerPid -gt 0){
  try {$owner=[Diagnostics.Process]::GetProcessById($lockOwnerPid);try {$stale=$owner.HasExited} finally {$owner.Dispose()}}
  catch [ArgumentException] {$stale=$true}
 }
 if($stale){[IO.File]::Delete($lockPath)}
} catch {} finally {if($lease){$lease.Dispose()}}`;
async function reclaim(file,remainingMs){
  const old=await snapshot(file);if(!old)return;
  const text=old.text.trim();const pid=/^[1-9]\d*$/.test(text)?Number(text):NaN;
  const stale=Number.isSafeInteger(pid)&&pid<=2147483647?!alive(pid):text===''&&Date.now()-old.stat.mtimeMs>60000;
  if(!stale)return;
  if(process.platform==='win32'){
    if(remainingMs<=0)return;
    await run('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(reclaimWindowsScript,'utf16le').toString('base64')],{
      windowsHide:true,timeout:Math.max(1,Math.min(2000,remainingMs)),maxBuffer:4096,env:{...process.env,GEMMA_PREF_LOCK_PATH:file}
    }).catch(()=>{});
    return;
  }
  const current=await snapshot(file);
  if(current?.text===old.text&&sameFile(current.stat,old.stat)&&current.stat.mtimeMs===old.stat.mtimeMs)await fs.unlink(file).catch(()=>{});
}
// Shared with DesktopPreferences.cs: exclusive create, decimal owner PID and a 3s wait.
export async function withPreferencesWriteLock(file,work,{timeoutMs=3000}={}){
  const lock=file+'.write.lock',deadline=Date.now()+timeoutMs;let handle;
  await fs.mkdir(path.dirname(file),{recursive:true});
  while(!handle){
    try{handle=await fs.open(lock,'wx');}
    catch(error){
      if(error.code!=='EEXIST'&&error.code!=='EACCES'&&error.code!=='EPERM')throw error;
      await reclaim(lock,deadline-Date.now());
      if(Date.now()>=deadline)throw Error('다른 창에서 설정을 저장하고 있어 잠금을 얻지 못했습니다. 잠시 뒤 다시 시도하세요.');
      await delay(Math.min(25,Math.max(1,deadline-Date.now())));
    }
  }
  let owned;
  try{
    owned=await handle.stat();await handle.writeFile(String(process.pid),'utf8');await handle.sync();
    return await work();
  }finally{
    await handle.close();
    const current=await snapshot(lock);
    if(owned&&sameFile(current?.stat,owned))await fs.unlink(lock).catch(()=>{});
  }
}
