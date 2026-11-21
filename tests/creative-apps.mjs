import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as creative from '../creative-apps.mjs';
import {desktopOperation,relevantSkills} from '../skills.mjs';
import {classifySkill} from '../skill-runtime.mjs';

async function installation(t,files){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'creative-app-test-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  for(const file of files){const dest=path.join(root,file);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.writeFile(dest,'fixture');}
  return root;
}

test('old Premiere is found from actual executable and never advertised as a ready UXP host',async t=>{
  const root=await installation(t,['Adobe/Adobe Premiere Pro 2020/Adobe Premiere Pro.exe']);
  const apps=await creative.discoverCreativeApps('프리미어에서 영상 잘라줘',{roots:[root],registrations:[]});
  assert.equal(apps.length,1);assert.equal(apps[0].id,'premiere');assert.equal(apps[0].installed,true);
  assert.equal(apps[0].scriptingReady,false);
  assert.ok(apps[0].routes.some(r=>r.kind==='local-ui'));
  assert.ok(!apps[0].routes.some(r=>r.kind==='local-script'&&r.available===true));
  assert.ok(apps[0].verification.editableExtensions.includes('.prproj'));
});

test('an installation label alone cannot claim Photoshop is installed',async t=>{
  const root=await installation(t,['Adobe/Adobe Photoshop 2026/readme.txt']);
  const [app]=await creative.discoverCreativeApps('포토샵 레이어 편집',{roots:[root],registrations:[]});
  assert.equal(app.id,'photoshop');assert.equal(app.installed,false);
  assert.equal(app.executable,null);
});

test('custom registered Blender path is validated and exposes local script execution with editable output verification',async t=>{
  const root=await installation(t,['custom/blender.exe']);
  const [app]=await creative.discoverCreativeApps('블렌더 모델링',{roots:[],registrations:[{name:'Blender',location:path.join(root,'custom')}]});
  assert.equal(app.id,'blender');assert.equal(app.installed,true);
  assert.ok(app.routes.some(r=>r.kind==='local-script'&&r.available===true));
  assert.ok(app.verification.editableExtensions.includes('.blend'));
  assert.ok(app.verification.checks.some(x=>/다시|reopen/i.test(x)));
});

test('CAD discovery does not substitute Blender for a requested AutoCAD project',async t=>{
  const root=await installation(t,['Blender Foundation/Blender 5.2/blender.exe','Autodesk/AutoCAD 2026/acad.exe']);
  const apps=await creative.discoverCreativeApps('AutoCAD 도면 치수 수정',{roots:[root],registrations:[]});
  assert.deepEqual(apps.map(a=>a.id),['autocad']);assert.equal(apps[0].installed,true);
  assert.ok(apps[0].verification.editableExtensions.includes('.dwg'));
});

// 2026-11-21: CAD 앱별 코드 경로. 헤드리스 실행기(FreeCADCmd·accoreconsole·kicad-cli)는 실제 파일이 있을 때만 준비됨.
test('a headless script runner is reported only when its file exists next to the app',async t=>{
  const withCmd=await installation(t,['FreeCAD 1.0/bin/FreeCAD.exe','FreeCAD 1.0/bin/FreeCADCmd.exe']);
  const [ready]=await creative.discoverCreativeApps('프리캐드로 부품 만들어',{roots:[withCmd],registrations:[]});
  assert.equal(ready.scriptingReady,true);
  const route=ready.routes.find(r=>r.kind==='local-script');
  assert.ok(route.scriptExecutable.endsWith(path.join('bin','FreeCADCmd.exe')));assert.match(route.guide,/freecad\.md/);
  const noCmd=await installation(t,['FreeCAD 1.0/bin/FreeCAD.exe']);
  const [gui]=await creative.discoverCreativeApps('프리캐드',{roots:[noCmd],registrations:[]});
  assert.equal(gui.installed,true);assert.equal(gui.scriptingReady,false);
  const acad=await installation(t,['Autodesk/AutoCAD LT 2026/acad.exe']);   // LT: accoreconsole 없음
  const [lt]=await creative.discoverCreativeApps('오토캐드 도면',{roots:[acad],registrations:[]});
  assert.equal(lt.installed,true);assert.equal(lt.scriptingReady,false);
});

test('COM-driven CAD apps and new CAD names are recognized with their guide and editable formats',async t=>{
  const root=await installation(t,['SOLIDWORKS Corp/SOLIDWORKS/SLDWORKS.exe','KiCad/9.0/bin/kicad.exe','KiCad/9.0/bin/kicad-cli.exe']);
  const [sw]=await creative.discoverCreativeApps('솔리드웍스로 브라켓 만들어줘',{roots:[root],registrations:[]});
  assert.equal(sw.id,'solidworks');assert.equal(sw.scriptingReady,true);
  assert.equal(sw.routes[0].comProgId,'SldWorks.Application');assert.ok(sw.verification.editableExtensions.includes('.sldprt'));
  const [kicad]=await creative.discoverCreativeApps('키캐드 거버 뽑아줘',{roots:[root],registrations:[]});
  assert.equal(kicad.id,'kicad');assert.ok(kicad.routes[0].scriptExecutable.endsWith('kicad-cli.exe'));
  for(const q of ['스케치업으로 집 모델','레빗 벽 추가','라이노 곡면','퓨전360 부품','인벤터 조립품','이 도면 dxf로 만들어'])assert.equal(creative.isCreativeRequest(q),true,q);
});

test('every app guide named in the profiles exists and is linked from the creative-apps skill',async()=>{
  const {fileURLToPath}=await import('node:url');   // 한글 폴더 이름은 URL에서 %인코딩되므로 fileURLToPath로 변환
  const dir=path.join(path.dirname(fileURLToPath(import.meta.url)),'..','스킬','creative-apps');
  const skill=await fs.readFile(path.join(dir,'SKILL.md'),'utf8');
  for(const name of ['autocad','freecad','solidworks','inventor','fusion','rhino','sketchup','revit','kicad','dxf','blender']){
    await fs.access(path.join(dir,'references',name+'.md'));
    assert.ok(skill.includes('references/'+name+'.md'),name);
  }
});

test('creative editing requests select executable local guidance and computer observation first',()=>{
  const catalog=[{name:'creative-apps',description:'설계 편집 앱'},{name:'computer-use:computer-use',description:'화면 조작'},{name:'image-gen',description:'새 사진 생성'}];
  for(const request of ['프리미어에서 영상 컷 편집해줘','포토샵 레이어 색 바꿔줘','AutoCAD 도면 치수 수정해줘','Blender에서 모델링해줘']){
    assert.equal(desktopOperation(request),true,request);
    assert.deepEqual(relevantSkills(catalog,request).slice(0,2).map(s=>s.name),['computer-use:computer-use','creative-apps']);
  }
  assert.equal(desktopOperation('프리미어 가격 알려줘'),false);
});

test('cloud-only skills are never mislabeled as local computer tools',()=>{
  assert.equal(classifySkill({name:'cloud-environment:cloud-desktop'}).runtime,'unsupported');
  assert.equal(classifySkill({name:'work-pets:create-pet'}).runtime,'connector');
  assert.equal(classifySkill({name:'pages:write-page'}).runtime,'connector');
  assert.equal(classifySkill({name:'sites:sites'}).runtime,'connector');
});
