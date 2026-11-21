import fs from 'node:fs/promises';
import path from 'node:path';

const key = value => value.normalize('NFKC').toLowerCase().replace(/[\s_.-]/g,'');
const projectName = value => key(value).replace(/학사(?:일정)?/g,'academic').replace(/달력|캘린더/g,'calendar');
const entryFiles = ['src/App.tsx','src/App.vue','src/main.tsx','src/main.ts','lib/main.dart','capacitor.config.ts','package.json'];
const skip = /^(?:\.|node_modules$|build$|dist$|bin$|obj$|venv$|__pycache__$|복구기록$|이전버전$|대화기록$|작업로그$)/i;
const source = /\.(?:cs|xaml|tsx?|jsx?|mjs|py|kt|java|html|css|json|xml|dart|swift|cpp|md)$/i;

async function walk(roots, depth, visit){
  const queue=roots.map(dir=>[path.resolve(dir),0]), seen=new Set();
  for(const [dir,level] of queue){
    if(seen.has(dir.toLowerCase()))continue;
    seen.add(dir.toLowerCase());
    const stat=await fs.lstat(dir).catch(e=>{if(e.code!=='ENOENT'&&e.code!=='ENOTDIR')throw e;});
    if(!stat?.isDirectory() || stat.isSymbolicLink())continue;
    const entries=await fs.readdir(dir,{withFileTypes:true});
    await visit(dir,entries);
    if(level<depth)for(const e of entries)if(e.isDirectory()&&!skip.test(e.name))queue.push([path.join(dir,e.name),level+1]);
  }
}

export async function matchWork({input,previous,generate,roots,workspace}){
  const keys=['app','file','topic','continuation','projectTask'];
  const format={type:'object',properties:Object.fromEntries(keys.map((k,i)=>[k,{type:i<3?'string':'boolean'}])),required:keys};
  const raw=await generate({format,maxTokens:220,messages:[
    {role:'system',content:'Classify local development work. projectTask=true for working on a named app/project or a source file, including a bare app name and follow-up edits. False for general conversation or operating installed apps. app = exact project name copied from user without particles or generic word 앱, empty if unnamed. file = exact filename mentioned, else empty. topic = one likely English source filename stem for the requested feature, else empty. continuation=true if referring to previous project without naming a new one. Return JSON.'},
    {role:'user',content:JSON.stringify({request:input,previousProject:previous?path.basename(previous):null})}
  ]});
  const intent=JSON.parse(raw);
  if(!intent.projectTask)return null;
  const app=String(intent.app||'').trim(), file=String(intent.file||'').trim();
  // 모델이 요청에 없는 이름을 프로젝트로 짐작하면(예: "다시하라고") 프로젝트 작업이 아닌 것으로 보고 일반 처리로 넘깁니다.
  // 예전에는 여기서 오류를 던져서 요청 전체가 "프로젝트 이름을 확인해 주세요"로 바로 끝났습니다.
  if(app && (!key(input).includes(key(app)) || !key(app) || /[<>:"/\\|?*\x00-\x1f]|[. ]$/.test(app) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(app) || app.length>100))return null;
  let dir=(!app && intent.continuation)?previous:null;
  if(app || (!dir && file)){
    const hits=new Set(), emptyHits=new Set();
    await walk(roots,4,async(folder,entries)=>{
            if(app && projectName(path.basename(folder))===projectName(app)){
        (entries.length?hits:emptyHits).add(folder);
      }
      if(!app && file && entries.some(e=>e.isFile()&&key(e.name)===key(file)))hits.add(folder);
      if(app && entries.some(e=>e.isFile()&&e.name==='package.json')){
        let pkg;try{pkg=JSON.parse(await fs.readFile(path.join(folder,'package.json'),'utf8'));}catch{return;}
        if([pkg.name,pkg.productName,pkg.build?.productName].some(x=>typeof x==='string'&&key(x)===key(app)))hits.add(folder);
      }
    });
    if(!hits.size)for(const folder of emptyHits)hits.add(folder);
    if(hits.size>1)throw Error('같은 이름의 후보가 있어요. 프로젝트 메뉴에서 사용할 폴더를 선택해 주세요.\n'+[...hits].join('\n'));
    dir=[...hits][0];
    // 없는 프로젝트 폴더는 "만들어 줘"처럼 새로 만들라는 요청일 때만 만듭니다(예전에는 "ektl" 같은 오타로도 빈 폴더가 생겼음).
    if(!dir && app && !/만들|생성|새\s*(?:로|프로젝트|앱|폴더)|시작하|create|new\s+(?:project|app)|init/i.test(input))return null;
    if(!dir && app){
      dir=path.join(workspace,app);
      await fs.mkdir(dir,{recursive:true});
    }
  }
  if(!dir)return null;
  const stat=await fs.lstat(dir);
  if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('프로젝트 폴더 위치를 확인해 주세요.');
  const files=[];
  await walk([dir],6,async(folder,entries)=>{
    for(const e of entries){
      if(!e.isFile())continue;
      const exact=file && key(file)===key(e.name);
      const stem=key(path.parse(e.name).name);
      if(exact || (source.test(e.name)&&stem.length>=3&&(key(input).includes(stem)||(intent.topic&&stem.includes(key(intent.topic)))))){
        files.push({exact,relative:path.relative(dir,path.join(folder,e.name))});
      }
    }
  });
  const bare=Boolean(app) && [key(app),key(app)+'앱',key(app)+'프로젝트'].includes(key(input.trim()));
  if(bare){
    const overview=[];
    for(const rel of ['README.md',...entryFiles,...entryFiles.map(f=>'mobile-app/'+f)]){
      if((await fs.lstat(path.join(dir,rel)).catch(()=>null))?.isFile())overview.push(rel);
    }
    for(const rel of overview.reverse()){
      if(!files.some(x=>key(x.relative.replaceAll('\\','/'))===key(rel)))files.unshift({exact:false,relative:rel});
    }
  }
  return {dir,bare,files:files.sort((a,b)=>Number(b.exact)-Number(a.exact)).slice(0,12).map(x=>x.relative)};
}
