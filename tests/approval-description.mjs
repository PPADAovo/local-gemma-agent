import test from 'node:test';
import assert from 'node:assert/strict';
import {approvalDescription} from '../approval-description.mjs';

test('mail approval names recipient, subject and attachments in Korean without argument keys',async()=>{
 const result=await approvalDescription({tool:'plugin_call',path:'gmail.send_attached_email',args:{to:'person@example.com',subject:'회의 자료',body:'확인 부탁드립니다.',files:['회의자료.pdf']}},()=>assert.fail('known operation should not need a model'));
 assert.match(result,/person@example.com/);assert.match(result,/회의자료.pdf/);assert.match(result,/발송/);assert.match(result,/제목: 회의 자료/);
 assert.doesNotMatch(result,/send_attached_email|\bto\b|\bfiles\b|\{|\}/);
});
test('page and desktop actions describe the visible target and operation',async()=>{
 const result=await approvalDescription({tool:'browser_click',target:'B12',elementName:'보내기'},()=>assert.fail());
 assert.match(result,/보내기.*클릭/);assert.doesNotMatch(result,/browser_click|B12/);
 const typed=await approvalDescription({tool:'type',text:'안녕하세요',elementName:'본문'},()=>assert.fail());
 assert.match(typed,/본문/);assert.match(typed,/안녕하세요/);assert.match(typed,/입력/);
});
test('complex commands explain the actual command rather than repeat the overall user request',async()=>{
 let received;
 const result=await approvalDescription({tool:'run',text:"Remove-Item -LiteralPath 'old.txt'",root:'C:/work',request:'정리해줘'},async data=>{received=data;return {work:'파일을 삭제합니다.',target:'C:/work/old.txt',effect:'파일이 삭제되며 휴지통으로 이동하지 않습니다.'};});
 assert.match(received.text,/Remove-Item/);assert.match(result,/old.txt/);assert.match(result,/휴지통/);assert.doesNotMatch(result,/Remove-Item|-LiteralPath|정리해줘/);
});
test('a missing or technical explanation cannot become an approval card',async()=>{
 for(const value of [null,{}, {work:'실행합니다.',target:'',effect:''},{work:'Remove-Item old.txt',target:'old.txt',effect:'삭제'}])
  await assert.rejects(()=>approvalDescription({tool:'run',text:'Remove-Item old.txt'},async()=>value),/작업 내용/);
});
