import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const directory=fileURLToPath(new URL('./기억/토큰/',import.meta.url));
export async function measuredJson(response){
  const data=await response.json();
  const input=data.prompt_eval_count,output=data.eval_count;
  if(Number.isSafeInteger(input)&&input>=0&&Number.isSafeInteger(output)&&output>=0){
    const date=new Date().toISOString();
    try{
      await fs.mkdir(directory,{recursive:true});
      await fs.appendFile(path.join(directory,date.slice(0,10)+'.jsonl'),JSON.stringify({date,input,output,model:data.model})+'\n');
    }catch(error){console.error('토큰 기록 실패',error.code)}
  }
  return data;
}
