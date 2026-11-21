// 사이트 배포(GitHub Pages): 이 PC의 사이트 폴더를 사용자의 GitHub 개인 사이트 저장소(<아이디>.github.io)의
// <이름>/ 폴더에 한 번의 커밋으로 올리고, 실제 주소가 열리는지 확인합니다. 주소: https://<아이디>.github.io/<이름>/
// - 연결된 GitHub 서비스(plugin_call)만 씁니다. 비밀번호·토큰을 다루지 않습니다.
// - 인터넷에 공개되는 일이라, 올리기 전에 매번 사용자 승인을 받습니다(올릴 파일 목록과 주소를 보여 줌).
// - 저장소가 없으면 사용자에게 한 번만 만들어 달라고 요청합니다(연결된 도구로는 저장소를 만들 수 없음).
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

const MAX_FILES=200,MAX_FILE_BYTES=5*1024*1024,MAX_TOTAL_BYTES=25*1024*1024;
const TEXT=/\.(html?|css|js|mjs|json|txt|md|svg|xml|webmanifest|map|csv)$/i;
// 공개하면 안 되는 파일: 비밀 값·개인 설정·저장소 내부 파일
const SECRET=/(^|\/)(\.env(\..*)?|\.git|\.ssh|node_modules|.*\.(pem|key|pfx|p12|dpapi|sqlite|db)|id_rsa.*|credentials.*|secrets?\.json|preferences\.json)(\/|$)/i;
const SECRET_TEXT=/(?:-----BEGIN [A-Z ]*PRIVATE KEY-----|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|sk-[A-Za-z0-9_-]{30,}|AIza[0-9A-Za-z_-]{30,})/;

// 사이트 이름 → 주소에 쓸 폴더 이름(영문 소문자·숫자·하이픈)
// 같은 이름이면 항상 같은 주소가 되게 만듭니다(다시 올리면 같은 주소가 새 내용으로 바뀜). 한글 이름은 폴더 이름을, 그것도 없으면 이름에서 만든 짧은 고정 코드를 씁니다.
export function siteSlug(name,folder=''){
  const clean=v=>String(v||'').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,40);
  return clean(name)||clean(path.basename(String(folder||'')))||'site-'+createHash('sha1').update(String(name||folder||'site')).digest('hex').slice(0,6);
}

// 올릴 파일 모으기: 숨김·비밀 파일은 빼고, 크기 제한을 지킵니다.
export async function collectSite(dir){
  const root=path.resolve(dir);
  const st=await fs.stat(root).catch(()=>null);
  if(!st?.isDirectory())throw Error('올릴 사이트 폴더를 찾지 못했습니다: '+dir);
  const files=[],skipped=[];let total=0;
  async function walk(d){
    for(const e of await fs.readdir(d,{withFileTypes:true})){
      const full=path.join(d,e.name),rel=path.relative(root,full).split(path.sep).join('/');
      if(SECRET.test(rel)||e.name.startsWith('.')){skipped.push(rel);continue;}
      if(e.isDirectory()){await walk(full);continue;}
      if(!e.isFile())continue;
      const size=(await fs.stat(full)).size;
      if(size>MAX_FILE_BYTES){skipped.push(rel+' (5MB 초과)');continue;}
      const data=await fs.readFile(full);
      if(TEXT.test(rel) && SECRET_TEXT.test(data.toString('utf8'))){skipped.push(rel+' (비밀 값으로 보이는 글자 포함)');continue;}
      total+=size;files.push({rel,data,text:TEXT.test(rel)});
      if(files.length>MAX_FILES)throw Error('파일이 '+MAX_FILES+'개를 넘어 올리지 않았습니다. 사이트에 필요한 파일만 있는 폴더를 지정하세요.');
      if(total>MAX_TOTAL_BYTES)throw Error('전체 크기가 25MB를 넘어 올리지 않았습니다.');
    }
  }
  await walk(root);
  if(!files.some(f=>/^index\.html?$/i.test(f.rel)))throw Error('폴더 맨 위에 index.html이 없습니다. 첫 화면 파일 이름을 index.html로 하세요.');
  return {root,files,skipped,total};
}

const parse=v=>{if(typeof v!=='string')return v;try{return JSON.parse(v);}catch{return v;}};
const shaOf=v=>{const s=typeof v==='string'?v:JSON.stringify(v);return s.match(/\b[0-9a-f]{40}\b/)?.[0]||'';};

// call(name,args): 연결된 GitHub 도구 호출. confirm(title,question): 승인(거부하면 예외). userAction(text): 사용자에게 부탁하고 기다림.
// fetchUrl(url): 배포 확인용 HTTP 요청. sleep(ms): 기다리기.
export async function deploySite({dir,name,call,confirm,userAction,fetchUrl=url=>fetch(url,{redirect:'follow'}),sleep=ms=>new Promise(r=>setTimeout(r,ms)),progress=()=>{},waitSeconds=180}){
  const site=await collectSite(dir);
  const login=String(parse(await call('github.get_user_login',{}))?.login||'').trim();
  if(!login)throw Error('GitHub 연결에서 내 아이디를 확인하지 못했습니다. 설정의 플러그인에서 GitHub를 다시 연결해 주세요.');
  const repo=login+'/'+login+'.github.io';
  const slug=siteSlug(name,dir);
  const url='https://'+login.toLowerCase()+'.github.io/'+slug+'/';

  // 1) 개인 사이트 저장소 확인. 없으면 사용자가 한 번 만들어 줍니다.
  const getRepo=async()=>{try{return parse(await call('github.get_repo',{repository_full_name:repo}));}catch(e){if(/404|not found/i.test(e.message))return null;throw e;}};
  let info=await getRepo();
  if(!info){
    progress('GitHub Pages 저장소('+repo+')가 없어 만들어 달라고 요청합니다.');
    await userAction('GitHub에서 새 저장소를 한 번만 만들어 주세요. 이름: '+login+'.github.io / 공개(Public) / "Add a README file" 체크. 주소: https://github.com/new');
    info=await getRepo();
    if(!info)throw Error(repo+' 저장소를 찾지 못했습니다. 이름을 정확히 '+login+'.github.io 로, 공개(Public)로 만들었는지 확인해 주세요.');
  }
  if(String(info.visibility||'').toLowerCase()==='private' || info.private===true)
    throw Error(repo+' 저장소가 비공개라 무료 GitHub Pages로 공개되지 않습니다. 저장소 설정에서 공개(Public)로 바꿔 주세요.');
  const branch=String(info.default_branch||'main');

  // 2) 공개 전 승인: 무엇이 어디에 공개되는지 그대로 보여 줍니다.
  const list=site.files.slice(0,12).map(f=>'- '+f.rel).join('\n')+(site.files.length>12?'\n- …외 '+(site.files.length-12)+'개':'');
  await confirm('사이트 공개 승인','아래 파일 '+site.files.length+'개('+Math.ceil(site.total/1024)+'KB)를 인터넷에 공개합니다. 누구나 볼 수 있습니다.\n주소: '+url+'\n저장소: '+repo+' ('+branch+' 브랜치의 '+slug+'/ 폴더)\n'+list+
    (site.skipped.length?'\n올리지 않는 파일: '+site.skipped.slice(0,6).join(', '):''));

  // 3) 현재 브랜치 끝 커밋 → 파일마다 blob → tree → commit → 브랜치 이동(다른 변경과 겹치면 거절)
  // 브랜치 이름으로 최신 커밋을 읽고(github.fetch_commit), 그 커밋의 파일 목록(tree) ID를 git API로 읽습니다(github.fetch).
  const headInfo=parse(await call('github.fetch_commit',{repo_full_name:repo,commit_sha:branch}));
  const head=String(headInfo?.commit?.sha||headInfo?.sha||'').match(/^[0-9a-f]{40}$/)?.[0]||'';
  if(!head)throw Error(branch+' 브랜치의 최신 커밋을 찾지 못했습니다. 저장소를 만들 때 README를 추가했는지 확인해 주세요.');
  const raw=parse(await call('github.fetch',{url:'https://api.github.com/repos/'+repo+'/git/commits/'+head}));
  const gitCommit=parse(raw?.content??raw);
  const baseTree=String(gitCommit?.tree?.sha||gitCommit?.commit?.tree?.sha||'').match(/^[0-9a-f]{40}$/)?.[0]||'';
  // 기존 파일 목록(tree)을 모르면 새 커밋이 저장소 전체를 바꿔 다른 사이트·README가 지워집니다. 그 경우 올리지 않습니다.
  if(!baseTree)throw Error('저장소의 현재 파일 목록을 확인하지 못해 올리지 않았습니다(다른 파일이 지워질 수 있어서).');
  progress('사이트 파일 '+site.files.length+'개를 올리는 중');
  const elements=[];
  for(const f of site.files){
    const blob=parse(await call('github.create_blob',{repository_full_name:repo,content:f.text?f.data.toString('utf8'):f.data.toString('base64'),encoding:f.text?'utf-8':'base64'}));
    const sha=shaOf(blob);if(!sha)throw Error(f.rel+' 파일을 올리지 못했습니다.');
    elements.push({path:slug+'/'+f.rel,mode:'100644',type:'blob',sha});
  }
  // 폴더 이름이 _로 시작하는 파일도 그대로 보이게 Jekyll 처리를 끕니다(이미 있으면 그대로 둠).
  const nojekyll=parse(await call('github.create_blob',{repository_full_name:repo,content:'',encoding:'utf-8'}));
  if(shaOf(nojekyll))elements.push({path:'.nojekyll',mode:'100644',type:'blob',sha:shaOf(nojekyll)});
  // 다시 올릴 때: 이 사이트 폴더(<이름>/)에만 있고 이번에 없는 파일은 지웁니다(로컬에서 지운 쪽이 인터넷에 남지 않게).
  // 다른 사이트 폴더와 README는 건드리지 않습니다. 기존 목록을 못 읽으면 지우지 않고 더하기만 합니다.
  let removed=[];
  try{
    const listing=parse(await call('github.fetch',{url:'https://api.github.com/repos/'+repo+'/git/trees/'+baseTree+'?recursive=1'}));
    const existing=parse(listing?.content??listing);
    const keep=new Set(elements.map(e=>e.path));
    removed=(Array.isArray(existing?.tree)?existing.tree:[]).filter(e=>e.type==='blob'&&String(e.path).startsWith(slug+'/')&&!keep.has(e.path)).map(e=>e.path);
    for(const p of removed)elements.push({path:p,mode:'100644',type:'blob',sha:null});
  }catch{removed=[];}
  const tree=shaOf(parse(await call('github.create_tree',{repository_full_name:repo,tree_elements:elements,base_tree_sha:baseTree})));
  if(!tree)throw Error('올린 파일 묶음(tree)을 만들지 못했습니다.');
  const commit=shaOf(parse(await call('github.create_commit',{repository_full_name:repo,message:'사이트 배포: '+slug,tree_sha:tree,parent_sha:head})));
  if(!commit)throw Error('배포 커밋을 만들지 못했습니다.');
  await call('github.update_ref',{repository_full_name:repo,branch_name:branch,sha:commit,force:false,expected_sha:head});

  // 4) 실제 주소가 열리는지 확인(GitHub Pages는 보통 30초~2분 걸림). 첫 화면의 제목을 비교합니다.
  const index=site.files.find(f=>/^index\.html?$/i.test(f.rel));
  const title=index.data.toString('utf8').match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim()||'';
  progress('배포를 기다리는 중 · '+url);
  const deadline=Date.now()+waitSeconds*1000;let last='';
  while(Date.now()<deadline){
    try{
      const res=await fetchUrl(url+'?v='+commit.slice(0,7));
      const body=res.ok?await res.text():'';
      if(res.ok && (!title || body.includes(title)))return {ok:true,url,repo,commit,files:site.files.length,removed,skipped:site.skipped,title};
      last='HTTP '+res.status;
    }catch(e){last=e.message;}
    await sleep(10000);
  }
  return {ok:false,url,repo,commit,files:site.files.length,removed,skipped:site.skipped,title,
    note:'파일은 올렸지만 '+waitSeconds+'초 안에 주소가 열리지 않았습니다('+last+'). 처음 배포면 저장소 Settings → Pages에서 Branch가 '+branch+'로 되어 있는지 확인해 주세요. 몇 분 뒤 다시 열어 보면 보통 열립니다.'};
}
