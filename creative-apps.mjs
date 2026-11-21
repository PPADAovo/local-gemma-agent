import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);

// Profiles are execution guidance, not a claim that a plugin is connected or an edit succeeded.
const profiles=[
  {id:'premiere',name:'Adobe Premiere Pro',match:/premiere|프리미어/i,folder:/^Adobe Premiere(?: Pro)?/i,containers:['Adobe'],executables:['Adobe Premiere Pro.exe'],formats:['.prproj'],
    script:'Premiere 25.6 이상에서 UXP 플러그인과 호스트 연결을 확인한 경우에만 UXP 사용. 2020 등 구버전에 최신 UXP API를 보내지 마세요. 설치된 기존 CEP/ExtendScript 연결이 없으면 화면 조작을 사용합니다.',
    source:'https://developer.adobe.com/premiere-pro/uxp/plugins/',checks:['시퀀스 이름·해상도·프레임레이트 확인','트랙과 클립 경계·길이·오디오 동기 확인','요청하지 않은 속도·게인·효과 변경 여부 확인']},
  {id:'photoshop',name:'Adobe Photoshop',match:/photoshop|포토샵/i,folder:/^Adobe Photoshop/i,containers:['Adobe'],executables:['Photoshop.exe'],formats:['.psd','.psb'],
    script:'설치 버전에 맞는 JavaScript/JSX를 생성·검토한 뒤 File > Scripts > Browse로 실행합니다. UXP 사용 시 해당 버전과 실행 호스트를 먼저 확인합니다.',
    source:'https://helpx.adobe.com/photoshop/desktop/automate-tasks/automation-settings-and-presets/automate-photoshop-with-scripts.html',checks:['캔버스 크기·색상 모드 확인','레이어 이름·가시성·마스크와 편집 가능 상태 확인']},
  {id:'after-effects',name:'Adobe After Effects',match:/after\s*effects|애프터\s*이펙트|에프터\s*이펙트|애펙|에펙/i,folder:/^Adobe After Effects/i,containers:['Adobe'],executables:['Support Files/AfterFX.exe'],formats:['.aep'],
    script:'버전에 맞는 ExtendScript JSX를 준비한 뒤 File > Scripts > Run Script File로 실행합니다. 문서화된 afterfx -r은 실행 중인 세션에 영향을 줄 수 있으므로 먼저 프로젝트와 저장 상태를 확인합니다.',
    source:'https://helpx.adobe.com/after-effects/desktop/automate-in-after-effects/automate-animation/scripts.html',checks:['컴포지션 해상도·길이·프레임레이트 확인','레이어·키프레임·효과·누락된 소스 확인']},
  {id:'illustrator',name:'Adobe Illustrator',match:/illustrator|일러스트레이터|일러스트에서/i,folder:/^Adobe Illustrator/i,containers:['Adobe'],executables:['Support Files/Contents/Windows/Illustrator.exe'],formats:['.ai'],
    script:'설치 버전에서 지원하는 JavaScript/ExtendScript JSX를 작성하고 File > Scripts에서 실행합니다. 스크립트는 활성 문서와 아트보드를 먼저 검사해야 합니다.',
    source:'https://helpx.adobe.com/illustrator/desktop/automate-visualize-data/automate-actions/install-and-run-scripts.html',checks:['아트보드 크기·색상 모드·글꼴 확인','벡터 경로와 텍스트의 편집 가능 상태 확인']},
  {id:'blender',name:'Blender',match:/blender|블렌더/i,folder:/^Blender(?:\s|$)/i,containers:['Blender Foundation'],executables:['blender.exe'],formats:['.blend'],localScript:true,
    guide:'blender.md',
    script:'app_script 도구(app="blender")를 먼저 씁니다(사용법은 app-adapters/blender.md). 어댑터로 안 되는 일만 blender 실행 파일에 --background --disable-autoexec --python <검토한 스크립트.py>로 실행하고, 새 .blend로 저장한 뒤 별도 프로세스에서 다시 열어 객체·재질·치수를 검사합니다.',
    source:'https://docs.blender.org/api/5.0/info_tips_and_tricks.html',checks:['객체·메시·재질·단위·치수 확인','렌더나 뷰포트 이미지에서 구도 확인']},
  // CAD 프로필: scriptExecutables는 설치 폴더 안의 '화면 없이 코드를 실행하는' 프로그램(있을 때만 local-script 가능),
  // guide는 스킬/creative-apps/references 안의 앱 문서(조작법·코드 경로·커뮤니티 팁).
  {id:'autocad',name:'AutoCAD',match:/autocad|오토캐드|\bdwg\b/i,folder:/^AutoCAD(?:\s|$)/i,containers:['Autodesk'],executables:['acad.exe'],formats:['.dwg','.dxf'],
    scriptExecutables:['accoreconsole.exe'],guide:'autocad.md',
    script:'accoreconsole.exe /i "입력.dwg" /s "작업.scr" /l en-US 로 화면 없이 SCR을 실행합니다(LT에는 없을 수 있음). 열린 도면은 COM(pywin32, 좌표는 VARIANT 배열) 또는 AutoLISP. 새 2D 도면은 ezdxf로 DXF를 만드는 편이 확실합니다. 신뢰 경로나 보안 설정을 임의로 해제하지 않습니다.',
    source:'https://help.autodesk.com/cloudhelp/2026/ENU/AutoCAD-Core-Console/files/AUTOCAD_CORE_CONSOLE.html',checks:['모델/도면 공간·단위·축척·치수 확인','객체·레이어·참조 파일 확인']},
  {id:'freecad',name:'FreeCAD',match:/freecad|프리캐드/i,folder:/^FreeCAD/i,containers:[],executables:['bin/FreeCAD.exe','FreeCAD.exe'],formats:['.FCStd'],
    scriptExecutables:['bin/FreeCADCmd.exe','bin/freecadcmd.exe','FreeCADCmd.exe'],guide:'freecad.md',
    script:'app_script 도구(app="freecad")를 먼저 씁니다(사용법은 app-adapters/freecad.md, 저장은 도구가 함). 어댑터로 안 되는 일(STEP 내보내기·기존 FCStd 수정)만 FreeCADCmd "스크립트.py"로 실행하고, doc.recompute() 후 새 FCStd로 저장해 다시 열어 Shape.isValid()·Volume·BoundBox를 확인합니다.',
    source:'https://wiki.freecad.org/Headless_FreeCAD',checks:['문서·Body·스케치·구속 조건·치수 확인','형상 재계산 오류와 편집 가능 상태 확인']},
  {id:'solidworks',name:'SOLIDWORKS',match:/solid\s*works|솔리드\s*웍스|솔리드워크스/i,folder:/^SOLIDWORKS(?:\s|$)/i,containers:['SOLIDWORKS Corp'],executables:['SLDWORKS.exe','SOLIDWORKS/SLDWORKS.exe'],formats:['.sldprt','.sldasm','.slddrw'],
    comProgId:'SldWorks.Application',guide:'solidworks.md',
    script:'COM(pywin32 Dispatch("SldWorks.Application"))으로 조작합니다. API 단위는 미터. 정확한 호출은 매크로 녹화(도구→매크로→기록)로 얻습니다.',
    source:'https://help.solidworks.com/2023/English/api/sldworkselecapihelp/index.html',checks:['피처 트리 오류·재생성 상태 확인','질량 특성·치수·구성 확인']},
  {id:'inventor',name:'Autodesk Inventor',match:/inventor|인벤터/i,folder:/^Inventor(?:\s|$)/i,containers:['Autodesk'],executables:['Bin/Inventor.exe'],formats:['.ipt','.iam','.idw'],
    comProgId:'Inventor.Application',guide:'inventor.md',
    script:'COM(pywin32 Dispatch("Inventor.Application"))으로 조작합니다. API 길이 단위는 항상 cm(표시 단위와 무관).',
    source:'https://help.autodesk.com/cloudhelp/2025/ENU/Inventor-API/files/UnitsOfMeasure.htm',checks:['모델 브라우저 오류 확인','질량 특성·범위 상자(cm) 확인']},
  {id:'fusion',name:'Autodesk Fusion',match:/fusion\s*360|퓨전\s*360|autodesk\s*fusion|퓨전에서/i,folder:/^Autodesk Fusion/i,containers:['Autodesk'],executables:['Fusion360.exe','FusionLauncher.exe'],formats:['.f3d'],
    guide:'fusion.md',
    script:'Fusion API는 Fusion 밖·헤드리스로 실행할 수 없습니다. API\\Scripts 폴더에 run(context) 스크립트를 만든 뒤 Fusion에서 Shift+S로 실행합니다. 단위 cm.',
    source:'https://help.autodesk.com/cloudhelp/ENU/Fusion-360-API/files/PythonSpecific_UM.htm',checks:['타임라인 오류 확인','바디·스케치 치수 확인']},
  {id:'rhino',name:'Rhino',match:/rhino|라이노|grasshopper|그래스호퍼/i,folder:/^Rhino\s*\d/i,containers:[],executables:['System/Rhino.exe'],formats:['.3dm'],
    guide:'rhino.md',
    script:'Rhino.exe /nosplash /runscript="_-RunPythonScript (경로.py)" — 경로는 괄호로 감싸고 스크립트 첫 줄에 #! python 3.',
    source:'https://developer.rhino3d.com/guides/rhinopython/python-running-scripts/',checks:['문서 단위·객체 수 확인','바운딩 박스·부피 확인']},
  {id:'sketchup',name:'SketchUp',match:/sketch\s*up|스케치업/i,folder:/^SketchUp(?:\s|$)/i,containers:['SketchUp'],executables:['SketchUp/SketchUp.exe','SketchUp.exe'],formats:['.skp'],
    guide:'sketchup.md',
    script:'SketchUp.exe -RubyStartup "스크립트.rb"(창은 항상 뜸) 또는 Ruby 콘솔에서 load. 내부 단위는 인치라 .mm를 붙입니다.',
    source:'https://community.sketchucation.com/topic/121859/sketchup-command-line-rubystartup',checks:['그룹·컴포넌트 구조 확인','치수(인치 변환) 확인']},
  {id:'revit',name:'Autodesk Revit',match:/revit|레빗|레비트/i,folder:/^Revit(?:\s|$)/i,containers:['Autodesk'],executables:['Revit.exe'],formats:['.rvt','.rfa'],
    guide:'revit.md',
    script:'pyRevit CLI(pyrevit run 스크립트.py 모델.rvt --revit=연도) 또는 Revit Batch Processor. 변경은 Transaction 안에서, 내부 단위는 피트.',
    source:'https://github.com/bvn-architecture/RevitBatchProcessor',checks:['워크셰어링·중앙 모델 상태 확인','요소·매개변수·단위 확인']},
  {id:'kicad',name:'KiCad',match:/kicad|키캐드|거버|gerber/i,folder:/^\d+\.\d+$/,containers:['KiCad'],executables:['bin/kicad.exe'],formats:['.kicad_pcb','.kicad_sch','.kicad_pro'],
    scriptExecutables:['bin/kicad-cli.exe'],guide:'kicad.md',
    script:'kicad-cli로 화면 없이 거버·드릴·PDF 내보내기와 DRC/ERC를 실행합니다. 버전마다 옵션이 달라 먼저 -h로 확인합니다.',
    source:'https://docs.kicad.org/9.0/en/cli/cli.html',checks:['DRC/ERC 결과 확인','출력 파일 목록(레이어별 .gbr, .drl) 확인']},
  {id:'acrobat',name:'Adobe Acrobat',match:/acrobat|아크로뱃/i,folder:/^(?:Adobe )?Acrobat/i,containers:['Adobe'],executables:['Acrobat/Acrobat.exe','Acrobat.exe'],formats:['.pdf'],
    script:'문서 편집 기능과 제품 라이선스를 화면에서 확인합니다. Reader 또는 비활성 편집 기능을 완전한 PDF 편집기로 간주하지 않습니다.',
    source:'https://helpx.adobe.com/acrobat.html',checks:['페이지 수·텍스트·주석·서식 확인','필요하면 글꼴 및 양식 필드 편집 가능 상태 확인']}
];

export function isCreativeRequest(request){
  const text=String(request||'');
  return profiles.some(p=>p.match.test(text))||/\b(?:creative|cad|design|editing|dxf)\b|어도비|설계\s*프로그램|편집\s*프로그램|영상\s*편집|3D\s*모델링|캐드|도면/i.test(text);
}
export function isCreativeOperation(request){
  return isCreativeRequest(request)&&/(?:편집|수정|잘라|자르|컷|레이어|모델링|그려|그리|만들|제작|저장|내보내|열어|실행|렌더|조작|클릭|입력|배치|자막|치수|변경|바꿔|적용|합쳐|이동|색칠)|\b(?:edit|cut|create|draw|model|render|open|export|save|resize|move)\b/i.test(String(request||''));
}

async function registeredApps(){
  if(process.platform!=='win32')return [];
  const command="[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $rows=@(Get-ItemProperty 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object {$_.DisplayName -match 'Adobe|Blender|AutoCAD|FreeCAD|SOLIDWORKS|Inventor|Fusion|Rhino|SketchUp|Revit|KiCad'} | ForEach-Object {[pscustomobject]@{name=$_.DisplayName;location=$_.InstallLocation}}); ConvertTo-Json -Compress -InputObject $rows";
  try{
    const {stdout}=await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,timeout:10000,maxBuffer:128*1024});
    const rows=JSON.parse(stdout.replace(/^\uFEFF/,''));return Array.isArray(rows)?rows:[];
  }catch{return [];}
}
async function childDirectories(root){
  return (await fs.readdir(root,{withFileTypes:true}).catch(()=>[])).filter(e=>e.isDirectory()).map(e=>path.join(root,e.name));
}
const fileExists=file=>fs.stat(file).then(s=>s.isFile(),()=>false);

export async function discoverCreativeApps(query='',{roots,registrations}={}){
  const explicit=profiles.filter(p=>p.match.test(String(query)));
  const wanted=explicit.length?explicit:/adobe|어도비/i.test(String(query))?profiles.filter(p=>p.name.startsWith('Adobe')):profiles;
  roots=roots??[process.env.ProgramFiles,process.env['ProgramFiles(x86)']].filter(Boolean);
  registrations=registrations??await registeredApps();
  const baseDirs=new Set(roots.filter(r=>typeof r==='string'&&path.isAbsolute(r)));
  const containers=[...new Set(wanted.flatMap(p=>p.containers))];
  for(const root of [...baseDirs]){
    for(const dir of await childDirectories(root))baseDirs.add(dir);
    for(const container of containers)for(const dir of await childDirectories(path.join(root,container)))baseDirs.add(dir);
  }
  const out=[];
  for(const p of wanted){
    const locations=[...baseDirs].filter(dir=>p.folder.test(path.basename(dir)));
    for(const row of registrations){
      if(!p.match.test(String(row.name))||typeof row.location!=='string'||!path.isAbsolute(row.location))continue;
      locations.push(row.location,...(await childDirectories(row.location)).filter(dir=>p.folder.test(path.basename(dir))));
    }
    let executable=null,installDir=null;
    for(const dir of [...new Set(locations)].sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}))) {
      for(const name of p.executables)if(await fileExists(path.join(dir,name))){executable=path.join(dir,name);installDir=dir;break;}
      if(executable)break;
    }
    if(!executable&&!explicit.length&&!/adobe|어도비/i.test(String(query)))continue;
    const installed=Boolean(executable);
    // 화면 없이 코드를 실행하는 프로그램(accoreconsole·FreeCADCmd·kicad-cli)은 실제 파일이 있을 때만 '준비됨'으로 봅니다.
    let scriptExecutable=null;
    if(installDir)for(const name of p.scriptExecutables||[])if(await fileExists(path.join(installDir,name))){scriptExecutable=path.join(installDir,name);break;}
    const scriptReady=installed&&(p.localScript===true||Boolean(scriptExecutable)||Boolean(p.comProgId));
    out.push({id:p.id,name:p.name,installed,executable,installationLabel:executable?locations.find(dir=>executable.startsWith(dir+path.sep)):null,
      scriptingReady:scriptReady,
      routes:[{kind:'local-script',available:scriptReady,precondition:p.script,source:p.source,
        ...(scriptExecutable?{scriptExecutable}:{}),...(p.comProgId?{comProgId:p.comProgId}:{}),...(p.guide?{guide:'creative-apps 스킬 references/'+p.guide}:{})},
        {kind:'local-ui',available:installed,tools:['windows','focus','look','click','key','type','drag','look'],precondition:'대상 프로젝트와 현재 화면을 확인하고 한 번 조작한 뒤 새 화면으로 결과 확인. 메뉴·좌표·단축키를 추측하지 마세요.'}],
      verification:{editableExtensions:p.formats,checks:[...p.checks,'요청한 저장 경로와 편집 가능한 원본 형식으로 저장하고 다시 열어 내용 확인','내보내기 요청이 있으면 별도 결과 파일의 크기·내용·재생/표시를 검증. 이미지나 동영상만 내보낸 것으로 원본 편집 완료를 보고하지 마세요.']},
      next:installed?'creative-apps 스킬을 읽고 로컬 스크립트의 실제 실행 조건을 확인하세요. 연결이 없으면 관찰 기반 화면 조작으로 수행합니다.':'실행 파일을 확인하지 못했습니다. find_file로 사용자가 지정한 설치 위치를 확인하세요. 다른 앱으로 임의 대체하지 마세요.'});
  }
  return out;
}
