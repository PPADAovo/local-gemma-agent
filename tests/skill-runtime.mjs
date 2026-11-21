import test from 'node:test';
import assert from 'node:assert/strict';
import {classifySkill} from '../skill-runtime.mjs';
import {existingDocumentProblem} from '../agent-loop.mjs';

test('skills are split into local, connected-service, and not-in-this-app',()=>{
  assert.equal(classifySkill({name:'spreadsheets'}).runtime,'local');
  assert.equal(classifySkill({name:'computer-use:computer-use'}).runtime,'local');
  assert.equal(classifySkill({name:'github-code'}).runtime,'connector');
  assert.equal(classifySkill({name:'notion:notion-setup'}).runtime,'connector');
  assert.equal(classifySkill({name:'google-drive:google-sheets'}).runtime,'connector');
  for(const name of ['create-hook','review-bugbot','imagegen','hatch-pet','spreadsheets:Spreadsheets','update-cursor-settings'])
    assert.equal(classifySkill({name}).runtime,'unsupported',name);
  assert.match(classifySkill({name:'imagegen'}).reason,/image-gen/);
});

test('typing into an existing document the user did not mention is stopped',()=>{
  assert.match(existingDocumentProblem('*지침.md - 메모장','메모장 열고 시험 123 입력해'),/새 문서/);
  assert.equal(existingDocumentProblem('지침.md - 메모장','지침.md에 한 줄 추가해'),'');
  assert.equal(existingDocumentProblem('제목 없음 - 메모장','메모장에 입력해'),'');
  assert.equal(existingDocumentProblem('naver.com - Chrome','검색해'),'');
  assert.match(existingDocumentProblem('*컴퓨터 조작 시험 123 - 메모장','메모장 열고 시험 456 입력해'),/저장하지 않은 다른 글/);
  assert.equal(existingDocumentProblem('*시험 456 - 메모장','입력해',[{ok:true,tool:'type'}]),'');
  assert.equal(existingDocumentProblem('보고서.txt - 메모장','써줘',[{ok:true,tool:'write',path:'C:\\w\\보고서.txt'}]),'');
});
