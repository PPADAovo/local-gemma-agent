import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';

export const convertible = file => /\.(pdf|docx|pptx|xlsx|html?)$/i.test(file);
export async function convertDocument(file, directory = path.dirname(file)){
  if(!convertible(file))throw Error('지원 형식: PDF, DOCX, PPTX, XLSX, HTML');
  const scratch=await fs.mkdtemp(path.join(os.tmpdir(),'markitdown-'));
  const temp=path.join(scratch,'document.md');
  try{
    const local=path.join(os.homedir(),'.local','bin','markitdown.exe');
    const cli=await fs.access(local).then(()=>local,()=>'markitdown');
    await promisify(execFile)(cli,[path.resolve(file),'-o',temp],{windowsHide:true,timeout:120000,env:{...process.env,PYTHONUTF8:'1'}});
    const markdown=await fs.readFile(temp,'utf8');
    if(!markdown.trim())throw Error('변환된 텍스트가 없습니다.');
    for(let i=1;;i++){
      const name=path.basename(file)+(i===1?'':' ('+i+')')+'.md';
      const output=path.join(directory,name);
      try{await fs.copyFile(temp,output,fs.constants.COPYFILE_EXCL);return {markdown,output};}
      catch(e){if(e.code!=='EEXIST')throw e;}
    }
  }finally{await fs.rm(scratch,{recursive:true,force:true});}
}
if(process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  for(const file of process.argv.slice(2)){
    try{console.log((await convertDocument(file)).output);}
    catch(e){console.error(path.basename(file),e.message);process.exitCode=1;}
  }
  if(process.exitCode && process.stdin.isTTY){console.error('Enter 키를 누르면 닫힙니다.');process.stdin.resume();process.stdin.once('data',()=>process.exit(1));}
}
