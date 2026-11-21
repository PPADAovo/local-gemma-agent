import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {checkBlenderCode,safeName,runBlenderPython,floatingParts} from '../blender-run.mjs';

// 2026-11-20 와인잔: 모델이 make_wine_glass를 조잡하게 다시 정의(원기둥 볼 + 떨어진 스템) → 도우미 재정의를 막음.
test('redefining an existing recipe helper is refused; new helper names are allowed',()=>{
 assert.match(checkBlenderCode('import bpy\ndef lathe(name, profile):\n    pass\nlathe("잔",[])'),/다시 정의하지 마세요/);
 assert.match(checkBlenderCode('def setup_scene():\n    pass'),/setup_scene/);
 assert.equal(checkBlenderCode('def make_table(w=1):\n    return lathe("상", [(0.001,0),(w,0.02)])\nmake_table()'),'');
 assert.equal(checkBlenderCode('make_wine_glass(height=0.22, bowl_radius=0.045)'),'');
});

test('parts that touch nothing else are reported as floating; a single part or touching parts are fine',()=>{
 const part=(name,min,max)=>({name,faces:10,bbox_min:min,bbox_max:max});
 const base=part('받침',[-0.04,-0.04,0],[0.04,0.04,0.01]);
 const stem=part('스템',[-0.005,-0.005,0.01],[0.005,0.005,0.08]);
 const bowl=part('볼',[-0.04,-0.04,0.1],[0.04,0.04,0.2]);          // 스템 끝(0.08)과 2cm 틈
 assert.deepEqual(floatingParts([base,stem,bowl]).map(p=>[p.name,p.gap_mm]),[['볼',20]]);
 assert.deepEqual(floatingParts([base,stem,{...bowl,bbox_min:[-0.04,-0.04,0.08]}]),[]);
 assert.deepEqual(floatingParts([bowl]),[]);
});

test('scene-only bpy code passes; file, process, network and dynamic execution are blocked',()=>{
 assert.equal(checkBlenderCode('make_wine_glass(height=0.21)\nsetup_scene()'),'');
 assert.equal(checkBlenderCode('v=lathe("꽃병",[(0.001,0),(0.04,0.2)])\nbpy.data.objects["꽃병"].location.z=0'),'');
 for(const bad of ['import os','from subprocess import run','__import__("os")','exec("x")','open("C:/x","w")','bpy.ops.wm.save_as_mainfile(filepath="x")','bpy.ops.script.reload()','bpy.app.handlers.load_post.append(f)','import socket'])
  assert.notEqual(checkBlenderCode(bad),'',bad);
 assert.equal(safeName('../와인:잔.blend'),'..와인잔');
});

// 물체별 레시피는 없으므로 범용 도우미로 만든 예시(app-adapters/blender.md의 패턴 예시와 같음)
const GLASS='g=lathe("와인잔",[(0.001,0),(0.035,0),(0.034,0.003),(0.006,0.01),(0.0045,0.02),(0.0045,0.08),(0.02,0.09),(0.04,0.13),(0.042,0.17),(0.037,0.2)],thickness=0.0018)\nassign(g,material("glass"))';
const MUG='m=lathe("머그컵",[(0.0005,0),(0.036,0),(0.0405,0.0012),(0.042,0.006),(0.042,0.05),(0.0424,0.1)],thickness=0.005)\ntube_arc("머그컵 손잡이",center=(0.04,0,0.052),radius=0.028,tube_radius=0.0055,parent=m)';
const exe='C:/Program Files/Blender Foundation/Blender 5.2/blender.exe';
const installed=await fs.stat(exe).then(()=>true,()=>false);
test('a recipe renders and reports dimensions; a faceless or empty scene is flagged, not reported done',{skip:!installed&&'Blender not installed',timeout:600000},async t=>{
 const out=await fs.mkdtemp(path.join(os.tmpdir(),'blender-run-'));t.after(()=>fs.rm(out,{recursive:true,force:true}));
 const good=await runBlenderPython({code:MUG+'\nsetup_scene()',name:'mug',outDir:out,size:64,exe});
 assert.equal(good.ok,true,good.report);assert.ok(good.image.length>100);assert.match(good.report,/머그컵 \(MESH\)/);
 const empty=await runBlenderPython({code:'def later():\n    '+MUG.split('\n')[0],name:'empty',outDir:out,size:0,exe});
 assert.equal(empty.ok,false);assert.match(empty.report,/메쉬 물체가 없습니다/);
 const broken=await runBlenderPython({code:'lathe("머그컵",',name:'bad',outDir:out,size:0,exe});
 assert.equal(broken.ok,false);assert.match(broken.report,/SyntaxError|코드 오류/);
});

test('the wine glass recipe passes; a glass with a detached bowl or a cut-off camera is not done',{skip:!installed&&'Blender not installed',timeout:600000},async t=>{
 const out=await fs.mkdtemp(path.join(os.tmpdir(),'blender-run-'));t.after(()=>fs.rm(out,{recursive:true,force:true}));
 const good=await runBlenderPython({code:GLASS+'\nsetup_scene()',name:'glass',outDir:out,size:64,exe});
 assert.equal(good.ok,true,good.report);
 // 7:56 실패 재현: 받침·스템·볼을 따로 만들고 볼을 스템에서 띄움
 const split='base=lathe("받침",[(0.001,0),(0.035,0),(0.035,0.004),(0.001,0.004)])\n'+
  'stem=lathe("스템",[(0.001,0.004),(0.005,0.004),(0.005,0.09),(0.001,0.09)])\n'+
  'bowl=lathe("볼",[(0.001,0.11),(0.04,0.11),(0.04,0.2),(0.001,0.2)])\nsetup_scene()';
 const detached=await runBlenderPython({code:split,name:'split',outDir:out,size:0,exe});
 assert.equal(detached.ok,false);assert.match(detached.report,/볼.*떨어져 있습니다/);
 // 카메라가 잔 아래쪽을 수평으로 가까이 봄 → 아래 절반만 보이고 볼 윗부분이 잘림
 const cut=await runBlenderPython({code:GLASS+'\ncam=bpy.data.objects.new("cam",bpy.data.cameras.new("cam"))\nbpy.context.scene.collection.objects.link(cam)\ncam.location=(0,-0.25,0.03)\ncam.rotation_euler=(math.radians(90),0,0)\nbpy.context.scene.camera=cam',name:'cut',outDir:out,size:0,exe});
 // 구도는 요청 내용이 아니므로 도구가 다시 맞춥니다: 잘리던 와인잔이 전부 보이고 결과는 통과.
 assert.equal(cut.reframed,true);assert.equal(cut.ok,true,cut.report);
 assert.equal(cut.objects.find(o=>o.name==='와인잔')?.fully_in_view,true);
});
import {duplicateGroups} from '../blender-run.mjs';
test('stacked copies left by live re-runs are reported as duplicates',()=>{
 assert.deepEqual(duplicateGroups([{name:'접시'},{name:'접시.001'},{name:'접시.002'},{name:'쿠키_0'},{name:'쿠키_1'},{name:'와인잔'}]),[['접시',['접시','접시.001','접시.002']]]);
 assert.deepEqual(duplicateGroups([{name:'와인잔'},{name:'바닥'}]),[]);
});
import {stackedParts} from '../blender-run.mjs';
test('two differently named parts placed exactly on top of each other are flagged',()=>{
 const part=(name,min,max)=>({name,faces:10,bbox_min:min,bbox_max:max});
 assert.deepEqual(stackedParts([part('주전자 주둥이',[0,0,0],[0.045,0.01,0.045]),part('주전자 손잡이',[0,0,0],[0.045,0.01,0.045]),part('몸통',[-0.06,-0.06,0],[0.06,0.06,0.09])]),[['주전자 주둥이','주전자 손잡이']]);
 assert.deepEqual(stackedParts([part('다리1',[0,0,0],[0.02,0.02,0.4]),part('다리2',[0.3,0,0],[0.32,0.02,0.4])]),[]);
});
