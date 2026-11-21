import test from 'node:test';
import assert from 'node:assert/strict';
import {installedProgramScriptRun,isDeleteCommand} from '../file-approval.mjs';

const root='C:/work',programRoots=['C:/Program Files','C:/Users/u/AppData/Local/Programs'];
const scripts={'C:/work/chair.py':'import bpy\nbpy.ops.mesh.primitive_cube_add()','C:/work/bad.py':'import os\nos.remove("C:/x")','C:/other/x.py':'import bpy'};
const check=cmd=>installedProgramScriptRun(cmd,{root,programRoots,readScript:f=>scripts[f]??null});

test('an installed program running a safe workspace script needs no approval in auto mode',()=>{
 const cmd='& "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" --background --python "C:/work/chair.py"';
 assert.equal(isDeleteCommand(cmd),true);assert.equal(check(cmd),true);
 assert.equal(check('& "C:/Users/u/AppData/Local/Programs/FreeCAD 1.1/bin/freecadcmd.exe" "C:/work/chair.py"'),true);
});
test('everything else keeps the approval',()=>{
 for(const cmd of [
  '& "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" --background --python "C:/work/bad.py"',
  '& "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" --background --python "C:/other/x.py"',
  '& "C:/Temp/tool.exe" --python "C:/work/chair.py"',
  '& "C:/Program Files/x/x.exe" --python "C:/work/chair.py"; Remove-Item C:/work -Recurse',
  '& "C:/Program Files/x/x.exe" --python "C:/work/missing.py"',
  '& "C:/Program Files/x/x.exe" --flag'
 ])assert.equal(check(cmd),false,cmd);
});
