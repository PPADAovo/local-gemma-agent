import {appDataDir} from './app-data.mjs';
import net from 'node:net';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
const execute=promisify(execFile);
async function identify({proof,pid}){
 if(!/^gemma-client-[0-9a-f-]{36}$/.test(proof) || !Number.isSafeInteger(pid) || pid<1)throw Error('Invalid client');
 const script=String.raw`$ErrorActionPreference='Stop'
 Add-Type -Namespace Gemma -Name PipeOwner -MemberDefinition '[System.Runtime.InteropServices.DllImport("kernel32.dll", SetLastError=true)] public static extern bool GetNamedPipeServerProcessId(Microsoft.Win32.SafeHandles.SafePipeHandle h,out uint pid);'
 $p=[IO.Pipes.NamedPipeClientStream]::new('.', $env:GEMMA_PROOF, [IO.Pipes.PipeDirection]::In)
 try{
  $p.Connect(2500)
  [uint32]$peer=0
  if(![Gemma.PipeOwner]::GetNamedPipeServerProcessId($p.SafePipeHandle,[ref]$peer) -or $peer -ne [uint32]$env:GEMMA_PEER){throw 'Owner mismatch'}
  $client=Get-CimInstance Win32_Process -Filter "ProcessId=$peer"
  $parent=Get-CimInstance Win32_Process -Filter "ProcessId=$($client.ParentProcessId)"
  if($client.ExecutablePath -ne $env:GEMMA_NODE -or [IO.Path]::GetDirectoryName($parent.ExecutablePath) -ne $env:GEMMA_ROOT -or $parent.Name -notmatch '^로컬 Gemma(?:-[^\\/]*)?\.exe$' -or $parent.CreationDate -gt $client.CreationDate){throw 'Unexpected application'}
  if($client.CommandLine -match '(?:^|\s)agent\.mjs\s+--rpc(?:\s|$)'){'agent'}
  elseif($client.CommandLine -match '(?:^|\s)work-tab-client\.mjs\s+--(?:show|hide)\s'){'viewer'}
  else{throw 'Unexpected client'}
 }finally{$p.Dispose()}`;
 const encoded=Buffer.from(script,'utf16le').toString('base64');
 const {stdout}=await execute(path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-EncodedCommand',encoded],{windowsHide:true,timeout:12000,env:{...process.env,GEMMA_NODE:process.execPath,GEMMA_PEER:String(pid),GEMMA_PROOF:proof,GEMMA_ROOT:path.dirname(fileURLToPath(import.meta.url))}});
 const role=stdout.trim();if(!['agent','viewer'].includes(role))throw Error('Invalid identity');return role;
}
import {createInterface} from 'node:readline';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
const directory=(process.env.GEMMA_WORKTAB_TEST_DIR||appDataDir());
const address='\\\\.\\pipe\\gemma-work-tab-'+randomUUID();
const sockets=new Map();
function send(m){
 const b=Buffer.from(JSON.stringify(m)),n=Buffer.alloc(4);n.writeUInt32LE(b.length);process.stdout.write(Buffer.concat([n,b]));
}
const server=net.createServer(s=>{
 const session=randomUUID();sockets.set(session,s);
 let role='',identifying=false;
 createInterface({input:s}).on('line',async line=>{
  try{
   if(line.length>900000)throw Error();
   const {id,op,args}=JSON.parse(line);
   if(!role){
    if(op!=='identify' || identifying)throw Error();
    identifying=true;role=await identify(args);
    if(!s.destroyed)s.write(JSON.stringify({id,value:true})+'\n');
    return;
   }
   if(role==='viewer' && !['showSaved','hideSaved'].includes(op))throw Error();
   send({session,id,op,args});
  }catch{s.destroy();}
 });
 s.on('error',()=>{});s.on('close',()=>{sockets.delete(session);send({session,op:'release'});});
});
await fs.mkdir(directory,{recursive:true});
await new Promise((ok,fail)=>server.once('error',fail).listen(address,ok));
const file=path.join(directory,'work-tab-'+(process.argv.includes('edge')?'edge':'chrome')+'.json');
const tmp=file+'.'+process.pid;await fs.writeFile(tmp,JSON.stringify({address}));await fs.rename(tmp,file);
let buf=Buffer.alloc(0);
process.stdin.on('data',d=>{buf=Buffer.concat([buf,d]);while(buf.length>=4){const n=buf.readUInt32LE();if(n>24*1024*1024)process.exit(1);if(buf.length<n+4)return;
 const message=JSON.parse(buf.subarray(4,4+n).toString());buf=buf.subarray(4+n);sockets.get(message.session)?.write(JSON.stringify(message)+'\n');}});
process.stdin.on('end',()=>process.exit(0));process.stdout.on('error',()=>process.exit(0));
