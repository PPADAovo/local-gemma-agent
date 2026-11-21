// 앱 잠금 비밀번호 보관: 사용자가 알려 준 비밀번호를 Windows DPAPI(현재 사용자 계정 전용 암호화)로 저장합니다.
// - 모델에게는 비밀번호 값을 보내지 않습니다. 모델은 unlock_app 도구 이름만 부르고, 입력은 앱 코드가 직접 합니다.
// - 값은 명령줄 인자가 아니라 환경 변수로 PowerShell에 넘깁니다(다른 프로그램의 프로세스 목록에 보이지 않게).
// - 로그·작업 기록·채팅 기록으로 내보내지 않습니다.
import {appDataDir} from './app-data.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const run=promisify(execFile);
// 지원하는 앱: 이름 → 저장 파일 이름과 창을 확인할 프로그램 이름
export const APPS={kakaotalk:{label:'카카오톡',process:/^kakaotalk$/i,words:/카카오톡|카톡|kakao\s*talk|kakao/i}};
const dir=()=>path.join(appDataDir(),'secrets');
const file=app=>path.join(dir(),app+'.dpapi');
export const appFromText=text=>Object.keys(APPS).find(app=>APPS[app].words.test(String(text||'')))||'';

async function powershell(script,env){
  const shell=process.env.SystemRoot?path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe'):'powershell.exe';
  const {stdout}=await run(shell,['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,env:{...process.env,...env}});
  return stdout;
}

export async function saveSecret(app,value){
  if(!APPS[app])throw Error('지원하지 않는 앱입니다.');
  const secret=String(value??'');
  if(!secret||secret.length>64)throw Error('비밀번호 형식이 올바르지 않습니다.');
  await fs.mkdir(dir(),{recursive:true});
  await powershell("Add-Type -AssemblyName System.Security; $b=[Text.Encoding]::UTF8.GetBytes($env:GEMMA_SECRET_VALUE); [IO.File]::WriteAllBytes($env:GEMMA_SECRET_FILE,[Security.Cryptography.ProtectedData]::Protect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))",
    {GEMMA_SECRET_VALUE:secret,GEMMA_SECRET_FILE:file(app)});
}
export async function readSecret(app){
  if(!APPS[app]||!await hasSecret(app))return null;
  const out=await powershell("Add-Type -AssemblyName System.Security; [Console]::Write([Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($env:GEMMA_SECRET_FILE),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)))",
    {GEMMA_SECRET_FILE:file(app)});
  // 콘솔 코드 페이지 때문에 한글 등이 깨지지 않도록 base64로 받아 UTF-8로 풉니다.
  return out?Buffer.from(out.trim(),'base64').toString('utf8')||null:null;
}
// ── 웹사이트 로그인 정보(아이디·비밀번호)도 같은 방식(DPAPI, 현재 Windows 사용자 전용)으로 사이트(호스트)별로 저장합니다.
// 값은 모델·로그·채팅 기록으로 보내지 않고, 로그인 칸 채우기는 앱 코드가 페이지에 직접 넣습니다.
const siteFile=host=>path.join(dir(),'site-'+String(host).toLowerCase().replace(/[^a-z0-9.-]/g,'_')+'.dpapi');
const validHost=host=>/^[a-z0-9.-]{1,253}$/i.test(String(host||''));
export async function saveSiteLogin(host,{username='',password}){
  if(!validHost(host))throw Error('사이트 주소가 올바르지 않습니다.');
  if(!password||String(password).length>256||String(username).length>256)throw Error('로그인 정보 형식이 올바르지 않습니다.');
  await fs.mkdir(dir(),{recursive:true});
  await powershell("Add-Type -AssemblyName System.Security; $b=[Text.Encoding]::UTF8.GetBytes($env:GEMMA_SECRET_VALUE); [IO.File]::WriteAllBytes($env:GEMMA_SECRET_FILE,[Security.Cryptography.ProtectedData]::Protect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser))",
    {GEMMA_SECRET_VALUE:JSON.stringify({u:String(username),p:String(password)}),GEMMA_SECRET_FILE:siteFile(host)});
}
export async function readSiteLogin(host){
  if(!validHost(host)||!await fs.stat(siteFile(host)).catch(()=>null))return null;
  try{
    const out=await powershell("Add-Type -AssemblyName System.Security; [Console]::Write([Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($env:GEMMA_SECRET_FILE),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)))",
      {GEMMA_SECRET_FILE:siteFile(host)});
    const {u,p}=JSON.parse(Buffer.from(out.trim(),'base64').toString('utf8'));return p?{username:u||'',password:p}:null;
  }catch{return null;}
}
export async function hasSiteLogin(host){return validHost(host)&&Boolean(await fs.stat(siteFile(host)).catch(()=>null));}
export async function forgetSiteLogin(host){if(validHost(host))await fs.rm(siteFile(host),{force:true});}
export async function savedSiteLogins(){
  const names=await fs.readdir(dir()).catch(()=>[]);
  return names.filter(n=>/^site-.+\.dpapi$/.test(n)).map(n=>n.slice(5,-6));
}

export async function hasSecret(app){return Boolean(APPS[app])&&Boolean(await fs.stat(file(app)).catch(()=>null));}
export async function forgetSecret(app){await fs.rm(file(app),{force:true});}

// 요청 속 "카톡 비번 1818이야" 같은 문장에서 비밀번호를 찾아 [저장됨]으로 가립니다.
// 결과: {app, secret, redacted} 또는 null
const PATTERN=/(카카오톡|카톡|kakao\s*talk|kakao)\s*(?:잠금\s*)?(?:비밀\s*번호|비번|암호|PIN|pin|패스워드|password)\s*(?:은|는|이|가|:|=)?\s*(\S{2,64}?)(\s*(?:이야|야|입니다|이에요|예요|에요|임|이다|요))?(?=$|\s|[.,](?:\s|$))/i;
export function extractAppPassword(text){
  const value=String(text??'');
  const m=value.match(PATTERN);
  if(!m)return null;
  const app=appFromText(m[1]);
  if(!app)return null;
  const secret=m[2];
  // "카톡 비번 바꿔줘"처럼 한글 낱말은 비밀번호가 아니라 요청입니다.
  if(/[가-힣ㄱ-ㅣ]/.test(secret))return null;
  const redacted=value.replace(m[0],m[1]+' 비밀번호 [저장됨]');
  return {app,secret,redacted};
}
// 채팅 기록 등에 남은 비밀번호 문장을 모델에게 보내기 전에 가립니다.
export const redactPasswords=text=>String(text??'').replace(new RegExp(PATTERN.source,'gi'),(whole,name,secret)=>
  /[가-힣ㄱ-ㅣ]/.test(secret)||!appFromText(name)?whole:name+' 비밀번호 [저장됨]');
