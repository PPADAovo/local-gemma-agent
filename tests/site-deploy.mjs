import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {deploySite,collectSite,siteSlug} from '../site-deploy.mjs';

const HEAD='a'.repeat(40),TREE='b'.repeat(40),NEWTREE='c'.repeat(40),COMMIT='d'.repeat(40);
async function siteFolder(extra={}){
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'site-'));
  await fs.writeFile(path.join(dir,'index.html'),'<!doctype html><title>내 메모장</title><h1>메모</h1>');
  await fs.writeFile(path.join(dir,'style.css'),'body{color:#222}');
  await fs.mkdir(path.join(dir,'img'));await fs.writeFile(path.join(dir,'img','logo.png'),Buffer.from([137,80,78,71,1,2,3]));
  for(const [name,body] of Object.entries(extra))await fs.writeFile(path.join(dir,name),body);
  return dir;
}
// 가짜 GitHub: 호출을 기록하고 정해진 값을 돌려줍니다.
function fakeGithub({repoExists=true,visibility='public',treeInCommit=true}={}){
  const calls=[];let exists=repoExists;
  const call=async(name,args)=>{
    calls.push([name,args]);
    switch(name){
      case 'github.get_user_login':return JSON.stringify({login:'exampleuser'});
      case 'github.get_repo':if(!exists)throw Error('GitHub API error 404: Not Found');return JSON.stringify({default_branch:'main',visibility});
      // 실제 응답 모양: fetch_commit은 commit.sha만, git 커밋(tree 포함)은 github.fetch의 content(JSON 글자) 안에 있습니다.
      case 'github.fetch_commit':assert.equal(args.commit_sha,'main');return JSON.stringify({commit:{sha:HEAD,message:'Initial commit'},url:'x'});
      case 'github.fetch':
        if(/\/git\/trees\//.test(args.url))return JSON.stringify({content:JSON.stringify({tree:[{path:'README.md',type:'blob'},{path:'other-site/index.html',type:'blob'},{path:'my-memo/index.html',type:'blob'},{path:'my-memo/old.html',type:'blob'},{path:'my-memo/img',type:'tree'}]})});
        assert.match(args.url,/\/git\/commits\/a{40}$/);return JSON.stringify({content:JSON.stringify(treeInCommit?{sha:HEAD,tree:{sha:TREE}}:{sha:HEAD})});
      case 'github.create_blob':return JSON.stringify({sha:String(calls.length).padStart(40,'0')});
      case 'github.create_tree':return JSON.stringify({sha:NEWTREE});
      case 'github.create_commit':return JSON.stringify({sha:COMMIT});
      case 'github.update_ref':return JSON.stringify({ref:'refs/heads/main'});
    }
    throw Error('unexpected '+name);
  };
  return {calls,call,create:()=>{exists=true;}};
}
const okFetch=async()=>({ok:true,status:200,text:async()=>'<title>내 메모장</title>'});

test('a site folder is published under its own folder in one commit, after approval, and the live address is checked',async()=>{
  const dir=await siteFolder();const gh=fakeGithub();const asked=[];
  const result=await deploySite({dir,name:'My Memo',call:gh.call,confirm:async(t,q)=>asked.push(q),userAction:async()=>assert.fail('저장소가 있으면 묻지 않음'),fetchUrl:okFetch,sleep:async()=>{}});
  assert.equal(result.ok,true);
  assert.equal(result.url,'https://exampleuser.github.io/my-memo/');
  assert.equal(asked.length,1);assert.match(asked[0],/파일 3개/);assert.match(asked[0],/누구나 볼 수 있습니다/);
  const tree=gh.calls.find(c=>c[0]==='github.create_tree')[1];
  assert.equal(tree.base_tree_sha,TREE,'기존 파일 위에 더함(다른 파일 보존)');
  // 이 사이트 폴더에만 있던 old.html은 지우고(sha:null), 다른 사이트와 README는 그대로 둡니다.
  assert.deepEqual(tree.tree_elements.map(e=>e.path).sort(),['.nojekyll','my-memo/img/logo.png','my-memo/index.html','my-memo/old.html','my-memo/style.css']);
  assert.equal(tree.tree_elements.find(e=>e.path==='my-memo/old.html').sha,null);
  assert.ok(!tree.tree_elements.some(e=>/README|other-site/.test(e.path)));
  assert.deepEqual(result.removed,['my-memo/old.html']);
  const png=gh.calls.find(c=>c[0]==='github.create_blob'&&c[1].encoding==='base64');assert.ok(png,'이미지는 base64로 올림');
  const ref=gh.calls.find(c=>c[0]==='github.update_ref')[1];
  assert.deepEqual([ref.sha,ref.force,ref.expected_sha],[COMMIT,false,HEAD],'강제로 덮어쓰지 않음');
  // 승인 전에는 아무것도 올리지 않습니다.
  const firstWrite=gh.calls.findIndex(c=>c[0]==='github.create_blob');
  assert.ok(firstWrite>0);
});

test('nothing is uploaded when the user cancels',async()=>{
  const dir=await siteFolder();const gh=fakeGithub();
  await assert.rejects(deploySite({dir,name:'x',call:gh.call,confirm:async()=>{throw Error('사용자가 사이트 공개를 취소했습니다.');},userAction:async()=>{},fetchUrl:okFetch,sleep:async()=>{}}),/취소/);
  assert.ok(!gh.calls.some(c=>/create_|update_ref/.test(c[0])));
});

test('a missing Pages repository is requested from the user once, and a private one is refused',async()=>{
  const dir=await siteFolder();const gh=fakeGithub({repoExists:false});const actions=[];
  const result=await deploySite({dir,name:'x',call:gh.call,confirm:async()=>{},userAction:async t=>{actions.push(t);gh.create();},fetchUrl:okFetch,sleep:async()=>{}});
  assert.equal(actions.length,1);assert.match(actions[0],/exampleuser\.github\.io/);assert.equal(result.ok,true);
  await assert.rejects(deploySite({dir,name:'x',call:fakeGithub({visibility:'private'}).call,confirm:async()=>{},userAction:async()=>{},fetchUrl:okFetch,sleep:async()=>{}}),/비공개/);
});

test('without the current file list the upload stops instead of replacing the whole repository',async()=>{
  const dir=await siteFolder();const gh=fakeGithub({treeInCommit:false});
  await assert.rejects(deploySite({dir,name:'x',call:gh.call,confirm:async()=>{},userAction:async()=>{},fetchUrl:okFetch,sleep:async()=>{}}),/지워질 수 있어서/);
  assert.ok(!gh.calls.some(c=>c[0]==='github.create_tree'));
});

test('secret-looking files are left out, a missing index.html is refused, and a slow Pages build is reported honestly',async()=>{
  const dir=await siteFolder({'.env':'TOKEN=1','config.js':'const k="ghp_'+'x'.repeat(36)+'";'});
  const site=await collectSite(dir);
  assert.deepEqual(site.files.map(f=>f.rel).sort(),['img/logo.png','index.html','style.css']);
  assert.ok(site.skipped.some(s=>s.startsWith('config.js')));
  const empty=await fs.mkdtemp(path.join(os.tmpdir(),'site-'));await fs.writeFile(path.join(empty,'a.html'),'x');
  await assert.rejects(collectSite(empty),/index\.html/);
  const result=await deploySite({dir,name:'x',call:fakeGithub().call,confirm:async()=>{},userAction:async()=>{},
    fetchUrl:async()=>({ok:false,status:404,text:async()=>''}),sleep:async()=>{},waitSeconds:0});
  assert.equal(result.ok,false);assert.match(result.note,/Settings → Pages/);
  assert.equal(siteSlug('나의 사이트!','C:/x/todo-app'),'todo-app');
  assert.match(siteSlug('나의 사이트!'),/^site-[0-9a-f]{6}$/);
  assert.equal(siteSlug('나의 사이트!'),siteSlug('나의 사이트!'),'같은 이름은 같은 주소');
  assert.equal(siteSlug('','C:/work/Todo App'),'todo-app');
});
