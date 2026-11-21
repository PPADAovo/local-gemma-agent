// blender_python 도구: 모델이 쓴 bpy 코드를 설치된 Blender에서 배경 실행(--background --factory-startup)하고,
// .blend 저장 → 렌더 PNG → 물체·치수·메쉬 상태를 돌려줍니다. 오류는 traceback 그대로 돌려줘 모델이 고쳐 다시 실행합니다.
// blender_helpers.py의 도우미(clear_scene, lathe, tube_arc, box, cylinder, sphere, material, setup_scene, remove_objects ...)를 미리 불러 둡니다.
// 실행은 별도 Blender 프로세스의 장면 안에서만 일어나므로 자동 승인 대상이지만, 파일·프로세스·네트워크를 건드리는 코드는 막습니다.
import fs from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFile,spawn} from 'node:child_process';
import net from 'node:net';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const BLOCKED=[
  [/\b(?:import|from)\s+(?:os|sys|subprocess|shutil|socket|ctypes|urllib|requests|http|pathlib|glob|tempfile|importlib|multiprocessing|threading|asyncio|winreg|webbrowser|pickle|marshal|zipfile|tarfile)\b/,'파일·프로세스·네트워크 모듈'],
  [/__import__|\bexec\s*\(|\beval\s*\(|\bcompile\s*\(|\bopen\s*\(|\bgetattr\s*\(\s*__builtins__|__builtins__|__subclasses__|__globals__/,'동적 실행·파일 열기'],
  [/bpy\.ops\.(?:wm\.(?:quit|save|open|read|append|link|url|path|recover|addon|keyconfig|context_)|preferences|script|file|import_|export_|text\.(?:run|save|open))/,'저장·열기·스크립트·환경설정 조작'],
  [/bpy\.utils\.(?:register|unregister|execfile|load|script_path)|bpy\.app\.handlers|bpy\.data\.libraries|\.filepath\s*=|\.save\s*\(|os\.environ/,'핸들러·외부 파일 경로'],
];
// blender_helpers.py에 이미 있는 도우미 이름들. 모델이 같은 이름으로 다시 정의하면 잘 만든 도우미가 조잡한 코드로 덮어써집니다
// (2026-11-20 와인잔: make_wine_glass를 원기둥 볼 + 떨어진 스템으로 다시 정의해 놓고 "깔끔한 형태"로 완료 보고).
const HELPERS=(()=>{
  try{return [...readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)),'blender_helpers.py'),'utf8').matchAll(/^def ([a-z]\w*)\s*\(/gm)].map(m=>m[1]);}
  catch{return [];}
})();
export function checkBlenderCode(code){
  const text=String(code||'');
  if(text.length>60000)return '코드가 너무 깁니다(6만 자 이하).';
  for(const [pattern,label] of BLOCKED)if(pattern.test(text))return '안전을 위해 실행하지 않았습니다: '+label+'은(는) blender_python 안에서 쓸 수 없습니다. 장면 조작(bpy.data, bmesh, 도우미 함수)만 쓰세요. 저장과 렌더는 도구가 자동으로 합니다.';
  const redefined=HELPERS.filter(name=>new RegExp('^\\s*def\\s+'+name+'\\s*\\(','m').test(text));
  if(redefined.length)return '이미 있는 도우미 '+redefined.join(', ')+'을(를) 다시 정의하지 마세요. 그대로 불러 쓰고 모양은 매개변수로 바꾸세요(예: lathe("와인잔", [(반지름, 높이), ...], thickness=0.002)). 도우미에 없는 모양만 lathe(name, profile)로 새로 만드세요.';
  return '';
}

const WRAPPER=String.raw`
import sys, json, traceback
args = sys.argv[sys.argv.index('--') + 1:]
app_dir, code_file, blend_path, png_path, size, keep = args[0], args[1], args[2], args[3], int(args[4]), args[5] == '1'
sys.path.insert(0, app_dir)
import bpy
import blender_helpers as _recipes
from blender_helpers import *
result = {'ok': True, 'error': ''}
with open(code_file, encoding='utf-8') as handle:
    _source = handle.read()
if not keep:
    clear_scene()
try:
    exec(compile(_source, 'blender_python', 'exec'), {'__name__': '__main__', 'bpy': bpy, 'math': __import__('math'), 'bmesh': __import__('bmesh'), 'mathutils': __import__('mathutils'), **{k: v for k, v in vars(_recipes).items() if not k.startswith('_')}})
except Exception:
    result['ok'] = False
    result['error'] = traceback.format_exc(limit=6)[-3000:]
try:
    if result['ok']:
        rows = report()
        cut = [r for r in rows if r.get('type') == 'MESH' and r.get('name') != '바닥' and r.get('fully_in_view') is False]
        if cut or not any(o.type == 'CAMERA' for o in bpy.context.scene.objects):
            setup_scene()
            result['reframed'] = True
            rows = report()
        result['objects'] = rows
        bpy.ops.wm.save_as_mainfile(filepath=blend_path, check_existing=False)
        result['blend'] = blend_path
        if size > 0:
            render_png(png_path, size)
            result['png'] = png_path
except Exception:
    result['ok'] = False
    result['error'] = (result['error'] + '\n' + traceback.format_exc(limit=6))[-3000:]
print('@@BLENDER_RESULT ' + json.dumps(result, ensure_ascii=False))
sys.stdout.flush()
`;

async function blenderExecutable(){
  if(process.env.GEMMA_BLENDER_EXE)return process.env.GEMMA_BLENDER_EXE;
  const {discoverCreativeApps}=await import('./creative-apps.mjs');
  const app=(await discoverCreativeApps('blender')).find(a=>a.id==='blender'&&a.installed&&a.executable);
  if(!app)throw Error('이 PC에서 Blender(blender.exe)를 찾지 못했습니다. discover_tools로 설치 여부를 확인하세요.');
  return app.executable;
}

export function safeName(name){
  return String(name||'blender-model').replace(/[\\/:*?"<>|\x00-\x1f]/g,'').replace(/\.blend$/i,'').trim().slice(0,60)||'blender-model';
}

// 부품(메쉬 물체)이 둘 이상일 때, 어떤 다른 부품과도 닿지 않는(경계 상자 사이 틈 > 2mm) 부품을 찾습니다.
// 물체마다 report()가 준 월드 경계 상자(bbox_min/bbox_max, 미터)를 씁니다.
export function floatingParts(models,toleranceM=0.002){
  const parts=(models||[]).filter(o=>Array.isArray(o.bbox_min)&&Array.isArray(o.bbox_max)&&o.faces>0);
  if(parts.length<2)return [];
  const gap=(a,b)=>Math.max(0,...[0,1,2].map(i=>Math.max(a.bbox_min[i]-b.bbox_max[i],b.bbox_min[i]-a.bbox_max[i])));
  return parts.map(p=>({p,g:Math.min(...parts.filter(q=>q!==p).map(q=>gap(p,q)))}))
    .filter(({g})=>g>toleranceM).map(({p,g})=>({...p,gap_mm:Math.round(g*1000*10)/10}));
}

// ── 열린 Blender 실시간 연결(blender_bridge.py) ──────────────────────────────
// 앱이 띄운 Blender 창 안의 소켓 서버에 코드를 보내 그 창에서 바로 실행합니다(장면·변수 유지, IDLE처럼).
export function bridgeStateFile(){
  return process.env.GEMMA_BLENDER_BRIDGE_FILE||path.join(process.env.GEMMA_DATA_DIR||path.join(process.env.LOCALAPPDATA||os.tmpdir(),'LocalGemmaDesktop'),'blender-bridge.json');
}
function bridgeRequest(state,payload,timeoutMs){
  return new Promise((resolve,reject)=>{
    const socket=net.connect({host:'127.0.0.1',port:state.port});
    let data='';const timer=setTimeout(()=>{socket.destroy();reject(Error('열린 Blender가 '+Math.round(timeoutMs/1000)+'초 안에 응답하지 않았습니다.'));},timeoutMs);
    socket.setEncoding('utf8');
    socket.on('connect',()=>socket.write(JSON.stringify({...payload,token:state.token})+'\n'));
    socket.on('data',chunk=>{data+=chunk;});
    socket.on('error',error=>{clearTimeout(timer);reject(error);});
    socket.on('close',()=>{clearTimeout(timer);try{resolve(JSON.parse(data.trim()));}catch{reject(Error('열린 Blender 응답을 읽지 못했습니다.'));}});
  });
}
const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
export async function liveBridge(){
  try{
    const state=JSON.parse(await fs.readFile(bridgeStateFile(),'utf8'));
    if(!state?.port||!state.token||!alive(Number(state.pid)))return null;
    const pong=await bridgeRequest(state,{ping:true},3000);
    return pong?.pong?state:null;
  }catch{return null;}
}
// 연결된 창이 없으면 실시간 연결 Blender 창을 새로 띄웁니다(빈 장면으로 시작). 띄우지 못하면 null.
export async function launchLiveBlender(exe,{waitMs=60000}={}){
  exe=exe||await blenderExecutable();
  const file=bridgeStateFile();
  await fs.rm(file,{force:true}).catch(()=>{});
  const child=spawn(exe,['--factory-startup','--python',path.join(here,'blender_bridge.py')],
    {detached:true,stdio:'ignore',env:{...process.env,GEMMA_BLENDER_BRIDGE_FILE:file,GEMMA_BLENDER_FRESH:'1'}});
  child.unref();
  for(const until=Date.now()+waitMs;Date.now()<until;){
    await new Promise(r=>setTimeout(r,500));
    const state=await liveBridge();
    if(state)return state;
  }
  return null;
}

// '접시', '접시.001', '접시.002'처럼 Blender가 이름 뒤에 번호를 붙인 복사본 묶음.
export function duplicateGroups(models){
  const groups=new Map();
  for(const o of models||[]){const base=String(o.name).replace(/\.\d{3}$/,'');groups.set(base,[...(groups.get(base)||[]),o.name]);}
  return [...groups].filter(([,names])=>names.length>1&&names.some(n=>/\.\d{3}$/.test(n)));
}
// 월드 경계 상자가 1mm 안으로 같은(완전히 겹친) 서로 다른 부품 쌍. 복사본('.001')은 duplicateGroups가 따로 봅니다.
export function stackedParts(models){
  const parts=(models||[]).filter(o=>Array.isArray(o.bbox_min)&&Array.isArray(o.bbox_max)&&o.faces>0);
  const same=(p,q)=>[0,1,2].every(i=>Math.abs(p.bbox_min[i]-q.bbox_min[i])<0.001&&Math.abs(p.bbox_max[i]-q.bbox_max[i])<0.001);
  const base=n=>String(n).replace(/\.\d{3}$/,'');
  const pairs=[];
  for(let i=0;i<parts.length;i++)for(let j=i+1;j<parts.length;j++)if(base(parts[i].name)!==base(parts[j].name)&&same(parts[i],parts[j]))pairs.push([parts[i].name,parts[j].name]);
  return pairs;
}
// 실행 결과(배경·실시간 공통)를 모델에게 보일 사실 보고로 바꿉니다. 저장된 파일의 실제 경로·수정 시각을 붙입니다.
async function describeResult(result,{live}){
    let image='';
    if(result.png)image=(await fs.readFile(result.png).catch(()=>Buffer.alloc(0))).toString('base64');
    const objects=(result.objects||[]).map(o=>'- '+o.name+' ('+o.type+') 크기 '+o.dimensions.join('×')+'m'+(o.faces!=null?' · 면 '+o.faces+(o.materials?.length?' · 재질 '+o.materials.join(','):'')+(o.invalid_geometry_fixed?' · 잘못된 메쉬를 고침':''):'')).join('\n');
    // 숫자로 확인할 수 있는 문제는 글로 분명히 알려 줍니다(2026-11-20 꽃병: 면 없는 메쉬·카메라 밖 물체를 "완료"로 보고).
    const models=(result.objects||[]).filter(o=>o.type==='MESH'&&o.name!=='바닥');
    const warnings=[
      ...(!models.length?['바닥 말고는 메쉬 물체가 없습니다. 함수를 정의만 하고 호출하지 않았는지 확인하세요.']:[]),
      ...models.filter(o=>o.faces===0).map(o=>o.name+'에 면이 없어 렌더에 보이지 않습니다(점·선만 회전). lathe(name, profile, thickness)를 쓰세요.'),
      ...models.filter(o=>o.faces>0&&o.in_camera_view===false).map(o=>o.name+'이(가) 카메라 화면 밖에 있습니다. 직접 만든 카메라를 지우고 setup_scene(물체)를 쓰세요.'),
      // 일부만 보이는 것도 문제입니다(2026-11-20 와인잔: 볼 윗부분이 화면 밖으로 잘렸는데 완료 보고).
      ...models.filter(o=>o.faces>0&&o.in_camera_view===true&&o.fully_in_view===false).map(o=>o.name+'의 일부가 렌더 화면 밖으로 잘립니다. 직접 만든 카메라를 지우고 setup_scene()으로 전체가 보이게 하세요.'),
      // 여러 부품으로 만든 물체에서 다른 부품과 닿지 않고 떠 있는 부품(2026-11-20 와인잔: 스템이 볼과 떨어짐).
      ...floatingParts(models).map(o=>o.name+'이(가) 다른 부품과 닿지 않고 떨어져 있습니다(틈 '+o.gap_mm+'mm). 부품끼리 붙이거나 lathe 하나로 이어서 만드세요.'),
      // 실시간 연결에서 다시 실행할 때 지우지 않아 같은 물체가 쌓인 경우(2026-11-20: 접시 3개·쿠키 15개가 겹침).
      // 이름이 다른 두 부품이 같은 자리·같은 크기로 완전히 겹치면 하나만 보입니다(2026-11-21 찻주전자: 주둥이가 손잡이와 같은 자리).
      ...stackedParts(models).map(([x,y])=>x+'와(과) '+y+'이(가) 같은 자리에 같은 크기로 완전히 겹쳐 하나만 보입니다. 서로 다른 위치·방향으로 놓으세요.'),
      ...duplicateGroups(models).map(([base,names])=>base+' 복사본이 '+names.length+'개 겹쳐 있습니다('+names.slice(0,4).join(', ')+'). 다시 만들기 전에 remove_objects("'+base+'")로 지우세요.'),
      ...models.filter(o=>o.faces>0&&Math.max(...o.dimensions)<0.005).map(o=>o.name+'이(가) 너무 작습니다(5mm 미만). 단위는 미터입니다.')
    ];
    const report=result.ok&&warnings.length
      ?'Blender 실행은 됐지만 결과에 문제가 있어 아직 완성이 아닙니다:\n- '+warnings.join('\n- ')+'\n파일: '+result.blend+'\n물체:\n'+(objects||'(없음)')+'\n고쳐서 blender_python을 다시 실행하세요.'
      :result.ok
      ?'Blender 실행 성공.\n파일: '+result.blend+(result.png?'\n렌더: '+result.png:'')+'\n물체:\n'+(objects||'(없음)')+
        '\n렌더 이미지를 보고 모양·비율이 요청과 맞는지 확인하세요. 이상하면 매개변수를 고쳐 다시 실행하세요.'+
        (live?'':' 맞으면 open_file로 위의 .blend 파일(정확히 이 경로)을 열어 사용자에게 보여 주세요.')
      :'Blender 코드 오류(장면은 저장하지 않음):\n'+result.error+'\n오류 줄을 고쳐 blender_python을 다시 실행하세요.';
    const saved=result.blend?await fs.stat(result.blend).catch(()=>null):null;
    const fileLine=saved?'\n저장된 파일(실제 확인): '+result.blend+' · 수정 '+saved.mtime.toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})
      :(result.blend?'\n저장 파일을 찾지 못했습니다: '+result.blend:'');
    const where=live?'열린 Blender 창(실시간 연결)에서 실행했습니다. 화면에 바로 반영됐고 장면이 그대로 이어지므로 open_file로 다시 열지 마세요.\n':'';
    const pngExists=result.png?await fs.stat(result.png).then(()=>true,()=>false):false;
    return {ok:result.ok&&!warnings.length,warnings,report:where+report+fileLine+(result.output?'\n출력:\n'+String(result.output).slice(-1500):''),
      image,live,reframed:Boolean(result.reframed),objects:result.objects||[],before:result.before||null,blend:saved?result.blend:'',png:pngExists?result.png:''};
}

// 반환: {report: 모델에게 보일 글, image: 렌더 PNG base64(있으면), blend, png, ok, live, objects}
// live: 'auto'(연결된 창이 있으면 그 창), 'launch'(없으면 새로 띄움), false(항상 배경 실행)
export async function runBlenderPython({code,name,outDir,size=512,keepScene=false,timeoutMs=300000,exe,live=false}){
  const blocked=checkBlenderCode(code);
  if(blocked)throw Error(blocked);
  exe=exe||await blenderExecutable();
  await fs.mkdir(outDir,{recursive:true});
  const base=safeName(name);
  const blend=path.join(outDir,base+'.blend'),png=path.join(outDir,base+'.png');
  if(live){
    let state=await liveBridge();
    if(!state&&live==='launch')state=await launchLiveBlender(exe);
    if(state){
      const result=await bridgeRequest(state,{code:String(code||''),blend,png,size},timeoutMs);
      return describeResult(result,{live:true});
    }
  }
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'gemma-blender-'));
  try{
    const codeFile=path.join(temp,'code.py'),wrapper=path.join(temp,'run.py');
    await fs.writeFile(codeFile,String(code||''),'utf8');
    await fs.writeFile(wrapper,WRAPPER,'utf8');
    const out=await new Promise(resolve=>execFile(exe,['--background','--factory-startup','--disable-autoexec','--python',wrapper,'--',here,codeFile,blend,png,String(size),keepScene?'1':'0'],
      {windowsHide:true,timeout:timeoutMs,maxBuffer:16*1024*1024},(error,stdout,stderr)=>resolve({error,stdout:String(stdout||''),stderr:String(stderr||'')})));
    const line=out.stdout.split(/\r?\n/).reverse().find(l=>l.startsWith('@@BLENDER_RESULT '));
    if(!line){
      const tail=(out.stderr||out.stdout).trim().split(/\r?\n/).slice(-12).join('\n');
      throw Error('Blender 실행이 결과 없이 끝났습니다'+(out.error?.killed?'(시간 초과)':'')+'.\n'+tail.slice(-1500));
    }
    return await describeResult(JSON.parse(line.slice('@@BLENDER_RESULT '.length)),{live:false});
  }finally{await fs.rm(temp,{recursive:true,force:true}).catch(()=>{});}
}
