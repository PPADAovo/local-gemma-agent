import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fixKoreanTypo} from '../hangul-typo.mjs';
import {isRetryRequest} from '../agent-loop.mjs';
import {matchWork} from '../project-match.mjs';

test('English-mode typing of Korean is read as Korean, real English is kept',()=>{
  assert.equal(fixKoreanTypo('ektl'),'다시');
  assert.equal(fixKoreanTypo('ektlgkfkrh'),'다시하라고');
  assert.equal(fixKoreanTypo('hello'),null);
  assert.equal(fixKoreanTypo('ok'),null);
});

test('short redo phrases are retries, real requests starting with 다시 are not',()=>{
  for(const s of ['다시','다시하라고','다시 해 봐','다시 시도해줘','재시도','retry'])assert.equal(isRetryRequest(s),true,s);
  for(const s of ['다시 만들어줘 계산기 앱','다시 생각해보니 메일 보내지 마'])assert.equal(isRetryRequest(s),false,s);
});

test('project matching never fails the request and never creates folders for typos',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'project-match-'));
  try{
    const generate=app=>async()=>JSON.stringify({app,file:'',topic:'',continuation:false,projectTask:true});
    // 요청에 없는 이름을 짐작한 경우 → 오류 대신 일반 처리(null)
    assert.equal(await matchWork({input:'다시하라고',previous:null,generate:generate('portal'),roots:[root],workspace:root}),null);
    // 없는 이름, 만들라는 말 없음 → 폴더를 만들지 않음
    assert.equal(await matchWork({input:'ektl',previous:null,generate:generate('ektl'),roots:[root],workspace:root}),null);
    assert.deepEqual(await fs.readdir(root),[]);
    // 만들라는 요청이면 새 폴더를 만듦
    const made=await matchWork({input:'calc 앱 만들어줘',previous:null,generate:generate('calc'),roots:[root],workspace:root});
    assert.ok(made && (await fs.readdir(root)).includes('calc'));
  }finally{await fs.rm(root,{recursive:true,force:true});}
});

import {isSeparateRequest,userFacing} from '../agent-loop.mjs';
test('a mid-task message is a separate request only when it is a complete, unrelated request',()=>{
  const current='이전 요청: 캐드 설치해줘';
  assert.equal(isSeparateRequest('한빛대 비교과포털 프로그램 참여현황 알려줘',current),true);
  for(const s of ['2번','그거 말고 FreeCAD로 설치해줘','멈춰','캐드 말고 다른 설치 파일 찾아줘'])assert.equal(isSeparateRequest(s,current),false,s);
});
test('instructions meant for the model are removed from failure answers',()=>{
  const out=userFacing('입력 대상을 확인하지 못해 실행하지 않았습니다. 사용자에게 추측한 클릭을 승인해 달라고 묻지 말고 look으로 확인한 뒤 다른 대상을 선택하세요.');
  assert.equal(out,'입력 대상을 확인하지 못해 실행하지 않았습니다.');
  assert.equal(userFacing('메일을 보내지 못했습니다.'),'메일을 보내지 못했습니다.');
});
