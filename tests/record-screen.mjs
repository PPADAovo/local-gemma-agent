import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {runAgentLoop,specPrompt,systemPrompt} from '../agent-loop.mjs';
import {recordScreen,desktopRecordingPath} from '../external-media-tools.mjs';

test('a descriptive desktop recording request runs once without asking the model for substeps', async()=>{
  const calls=[];
  let modelCalls=0;
  const result=await runAgentLoop({
    input:'화면을 10초정도 녹화해서 바탕화면에 저장해',
    settings:{computerUse:true,noSpec:true,toolAllow:['record_screen']},
    context:{},
    chat:async()=>{modelCalls++;return JSON.stringify({tool:'reply',text:'완료했습니다.'});},
    execute:async action=>{
      calls.push(action);
      return {file:'C:\\Users\\User\\Desktop\\화면녹화.mp4',bytes:128,seconds:10};
    }
  });
  assert.equal(modelCalls,0);
  assert.equal(calls.length,1);
  assert.equal(calls[0].tool,'record_screen');
  assert.equal(calls[0].text,'10');
  assert.equal(calls[0].target,'desktop');
  assert.equal(result.complete,true);
});

test('recording guidance defines one atomic tool call in planning and execution prompts',()=>{
  assert.match(specPrompt(['record_screen']),/한 번의 호출|한 번에/);
  assert.match(systemPrompt({},['record_screen'],{}),/한 번의 호출|한 번에/);
});

test('recording creates its output directory and can use a controlled FFmpeg runner',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'record-screen-'));
  try{
    const output=path.join(root,'nested','capture.mp4');
    const result=await recordScreen(output,4,{
      findFfmpeg:async()=>({executable:'ffmpeg.exe'}),
      runCommand:async(_executable,args)=>{await fs.writeFile(args.at(-1),Buffer.from('fixture mp4'));}
    });
    assert.equal(result.file,output);
    assert.equal(result.seconds,4);
    assert.ok(result.bytes>0);
    assert.ok((await fs.stat(output)).isFile());
  }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('Desktop recording uses only a safe filename and creates the resolved known folder',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'record-desktop-'));
  try{
    const desktop=path.join(root,'OneDrive','Desktop');
    const output=await desktopRecordingPath('capture.mp4',{desktopPath:desktop});
    assert.equal(output,path.join(desktop,'capture.mp4'));
    assert.ok((await fs.stat(desktop)).isDirectory());
    await assert.rejects(desktopRecordingPath('..\\outside.mp4',{desktopPath:desktop}),/파일명|경로|바탕화면 폴더/);
    await assert.rejects(desktopRecordingPath('C:\\outside.mp4',{desktopPath:desktop}),/파일명|경로|바탕화면 폴더/);
    await assert.rejects(desktopRecordingPath('capture.txt',{desktopPath:desktop}),/예: desktop_record\.mp4/);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('Desktop recording accepts a full path that points at the Desktop itself',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'record-desktop-'));
  try{
    const desktop=path.join(root,'Desktop');
    const full=path.join(desktop.toUpperCase(),'desktop_record.mp4');
    assert.equal(await desktopRecordingPath(full,{desktopPath:desktop}),path.join(desktop,'desktop_record.mp4'));
    await assert.rejects(desktopRecordingPath(path.join(root,'temp','record.mp4'),{desktopPath:desktop}),/바탕화면 폴더에만/);
  }finally{await fs.rm(root,{recursive:true,force:true});}
});

test('recording uses the primary monitor at 30fps and falls back to gdigrab',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'record-screen-'));
  try{
    const calls=[];
    await recordScreen(path.join(root,'a.mp4'),3,{
      findFfmpeg:async()=>({executable:'ffmpeg.exe'}),
      runCommand:async(_exe,args)=>{calls.push(args);if(args.includes('lavfi'))throw Error('no ddagrab');await fs.writeFile(args.at(-1),'x');}
    });
    assert.equal(calls.length,2);
    assert.ok(calls[0].some(a=>a.startsWith('ddagrab=output_idx=0:framerate=30')));
    assert.ok(calls[1].includes('gdigrab'));
    assert.equal(calls[1][calls[1].indexOf('-framerate')+1],'30');
  }finally{await fs.rm(root,{recursive:true,force:true});}
});
