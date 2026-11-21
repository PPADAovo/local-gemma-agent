// FreeCAD 어댑터: Python(FreeCAD/Part). FreeCADCmd(창 없는 실행기)로 새 문서에서 코드를 실행하고 .FCStd로 저장합니다.
// 단위는 mm입니다(공통 상태 보고에서는 다른 어댑터와 같게 m로 바꿉니다). 창 없는 실행이라 렌더 이미지는 없습니다.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {safeName} from '../blender-run.mjs';

const BLOCKED=[
  [/\b(?:import|from)\s+(?:os|sys|subprocess|shutil|socket|ctypes|urllib|requests|http|pathlib|glob|tempfile|importlib|multiprocessing|threading|winreg|webbrowser|pickle|marshal|zipfile)\b/,'파일·프로세스·네트워크 모듈'],
  [/__import__|\bexec\s*\(|\beval\s*\(|\bcompile\s*\(|\bopen\s*\(|__builtins__|__subclasses__|__globals__/,'동적 실행·파일 열기'],
  [/\.(?:saveAs|save|exportStep|exportStl|exportIges|exportBrep|read|write)\s*\(|FreeCAD\.(?:open|openDocument|closeDocument|loadFile)|App\.(?:open|openDocument|closeDocument|loadFile)|Import\.|Mesh\.export|FreeCADGui/,'저장·열기·내보내기(도구가 자동으로 저장)'],
];
export function checkFreecadCode(code){
  const text=String(code||'');
  if(text.length>60000)return '코드가 너무 깁니다(6만 자 이하).';
  for(const [pattern,label] of BLOCKED)if(pattern.test(text))return '안전을 위해 실행하지 않았습니다: '+label+'은(는) FreeCAD 스크립트 안에서 쓸 수 없습니다. 문서(doc) 안의 형상 만들기만 쓰세요.';
  return '';
}

const WRAPPER=String.raw`
import os, json, traceback, math
import FreeCAD as App
import Part
result = {'ok': True, 'error': '', 'output': ''}
doc = App.newDocument('Model')
ns = {'App': App, 'FreeCAD': App, 'Part': Part, 'doc': doc, 'math': math, 'Vector': App.Vector}
with open(os.environ['GEMMA_FC_CODE'], encoding='utf-8') as handle:
    source = handle.read()
try:
    exec(compile(source, 'app_script', 'exec'), ns)
    doc.recompute()
except Exception:
    result['ok'] = False
    result['error'] = traceback.format_exc(limit=6)[-3000:]
rows = []
for o in doc.Objects:
    row = {'name': o.Label, 'type': o.TypeId, 'dimensions': [0, 0, 0]}
    shape = getattr(o, 'Shape', None)
    if shape is not None and not shape.isNull():
        bb = shape.BoundBox
        row.update(dimensions=[round(bb.XLength / 1000, 5), round(bb.YLength / 1000, 5), round(bb.ZLength / 1000, 5)],
                   valid=bool(shape.isValid()), volume_cm3=round(shape.Volume / 1000, 3), faces=len(shape.Faces),
                   solid=len(shape.Solids) > 0, visible=bool(getattr(o, 'Visibility', True)))
    rows.append(row)
result['objects'] = rows
if result['ok']:
    try:
        doc.saveAs(os.environ['GEMMA_FC_DOC'])
        result['document'] = os.environ['GEMMA_FC_DOC']
    except Exception:
        result['ok'] = False
        result['error'] = traceback.format_exc(limit=4)
# 콘솔 출력은 Windows에서 UTF-8이 아니라 한글 이름·경로가 깨집니다. 결과는 UTF-8 파일로 씁니다.
with open(os.environ['GEMMA_FC_RESULT'], 'w', encoding='utf-8') as handle:
    json.dump(result, handle, ensure_ascii=False)
`;

async function detect(){
  if(process.env.GEMMA_FREECAD_CMD)return process.env.GEMMA_FREECAD_CMD;
  const roots=[process.env.ProgramFiles,process.env['ProgramFiles(x86)'],process.env.LOCALAPPDATA&&path.join(process.env.LOCALAPPDATA,'Programs')].filter(Boolean);
  for(const root of roots){
    const dirs=(await fs.readdir(root).catch(()=>[])).filter(d=>/^freecad/i.test(d)).sort().reverse();
    for(const d of dirs)for(const exe of ['bin/freecadcmd.exe','bin/FreeCADCmd.exe']){
      const full=path.join(root,d,exe);if(await fs.stat(full).then(()=>true,()=>false))return full;
    }
  }
  return null;
}

export default {
  id:'freecad',name:'FreeCAD',language:'Python(FreeCAD·Part, 단위 mm)',kind:'3d',
  match:/freecad|프리캐드/i,
  detect,
  check:checkFreecadCode,
  async run({exe,code,name,outDir,timeoutMs=180000}){
    await fs.mkdir(outDir,{recursive:true});
    const document=path.join(outDir,safeName(name)+'.FCStd');
    const temp=await fs.mkdtemp(path.join(os.tmpdir(),'gemma-freecad-'));
    try{
      const codeFile=path.join(temp,'code.py'),wrapper=path.join(temp,'run.py');
      await fs.writeFile(codeFile,code,'utf8');await fs.writeFile(wrapper,WRAPPER,'utf8');
      const out=await new Promise(resolve=>execFile(exe,[wrapper],{windowsHide:true,timeout:timeoutMs,maxBuffer:16*1024*1024,
        env:{...process.env,GEMMA_FC_CODE:codeFile,GEMMA_FC_DOC:document,GEMMA_FC_RESULT:path.join(temp,'result.json')}},(error,stdout,stderr)=>resolve({error,stdout:String(stdout||''),stderr:String(stderr||'')})));
      const raw=await fs.readFile(path.join(temp,'result.json'),'utf8').catch(()=>'');
      if(!raw)throw Error('FreeCAD 실행이 결과 없이 끝났습니다'+(out.error?.killed?'(시간 초과)':'')+'.\n'+(out.stderr||out.stdout).trim().split(/\r?\n/).slice(-10).join('\n').slice(-1500));
      const r=JSON.parse(raw);
      // 공통 상태: 부피가 있는 형상은 'MESH'(장면 물체)로 봅니다.
      const state=(r.objects||[]).map(o=>({...o,type:o.solid||o.faces?'MESH':o.type}));
      const solids=state.filter(o=>o.type==='MESH');
      const warnings=[
        ...(!solids.length?['형상이 있는 물체가 없습니다. Part 형상을 만들어 doc.addObject("Part::Feature", 이름).Shape = 형상 으로 문서에 넣으세요.']:[]),
        ...solids.filter(o=>o.valid===false).map(o=>o.name+' 형상이 올바르지 않습니다(isValid=False).')
      ];
      const saved=r.document&&await fs.stat(r.document).catch(()=>null);
      const list=state.map(o=>'- '+o.name+' ('+o.type+') 크기 '+o.dimensions.map(v=>Math.round(v*1000*10)/10).join('×')+'mm'+(o.volume_cm3!=null?' · 부피 '+o.volume_cm3+'cm³':'')).join('\n');
      const report=!r.ok?'FreeCAD 코드 오류(저장하지 않음):\n'+r.error+'\n오류 줄을 고쳐 다시 실행하세요.'
        :(warnings.length?'FreeCAD 실행은 됐지만 아직 완성이 아닙니다:\n- '+warnings.join('\n- ')+'\n':'FreeCAD 실행 성공.\n')+'물체:\n'+(list||'(없음)')+
          (saved?'\n저장된 파일(실제 확인): '+r.document+' · 수정 '+saved.mtime.toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})+'\n창 없는 실행이라 렌더 이미지는 없습니다. 끝나면 open_file로 이 파일을 열어 보여 주세요.':'');
      return {ok:r.ok&&!warnings.length,warnings,report,image:'',live:false,before:null,objects:state,state,document:saved?r.document:'',files:saved?[r.document]:[]};
    }finally{await fs.rm(temp,{recursive:true,force:true}).catch(()=>{});}
  }
};
