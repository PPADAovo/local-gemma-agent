import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import os from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const git=promisify(execFile);

const hash = data => data === null ? null : createHash('sha256').update(data).digest('hex');
async function contents(file) {
  try { return await fs.readFile(file); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
export class History {
  constructor(directory, target) {
    this.directory = directory;
    this.target = target;
    this.id = randomUUID();
  }
  async change(relative, next, expected) {
    const file = await this.target(relative);
    const old = await contents(file);
    if(expected!==undefined && hash(old)!==hash(expected))throw Error("파일이 변경되었습니다. 다시 읽으세요.");
    if (old === null && next === null) throw Error('삭제할 파일이 없습니다.');
    if (hash(old) === hash(next)) return;
    const folder = path.join(this.directory,this.id);
    await fs.mkdir(folder,{recursive:true});
    const entry = {relative, old:old?.toString('base64') ?? null, after:hash(next)};
    await fs.appendFile(path.join(folder,'changes.jsonl'),JSON.stringify(entry)+'\n',{flush:true});
    if (next === null) await fs.unlink(file);
    else {
      await fs.mkdir(path.dirname(file),{recursive:true});
      const tmp = path.join(path.dirname(file),'.agent-'+randomUUID()+'.tmp');
      try {
        await fs.writeFile(tmp,next,{flag:'wx',flush:true});
        await fs.rename(tmp,file);
      } finally { await fs.rm(tmp,{force:true}); }
    }
  }
  async undo(id) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw Error('잘못된 복구 ID');
    const folder = path.join(this.directory,id);
    const entries = (await fs.readFile(path.join(folder,'changes.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
    const cursor = path.join(folder,'remaining');
    let count = Number((await contents(cursor))?.toString() ?? entries.length);
    while (count > 0) {
      const entry = entries[count-1];
      const file = await this.target(entry.relative);
      const data = await contents(file);
      const old = entry.old === null ? null : Buffer.from(entry.old,'base64');
      if (hash(data) !== hash(old)) {
        if (hash(data) !== entry.after) throw Error('후속 변경을 보존하기 위해 복구 중단: '+entry.relative);
        if (old === null) await fs.unlink(file);
        else await fs.writeFile(file,old);
      }
      await fs.writeFile(cursor+'.tmp',String(--count),{flush:true});
      await fs.rename(cursor+'.tmp',cursor);
    }
  }
  async summary(){
    const journal=await contents(path.join(this.directory,this.id,'changes.jsonl'));
    if(!journal)return [];
    const first=new Map();
    for(const line of journal.toString().trim().split('\n')){
      const entry=JSON.parse(line);
      if(!first.has(entry.relative))first.set(entry.relative,entry.old);
    }
    const folder=await fs.mkdtemp(path.join(os.tmpdir(),'gemma-diff-'));
    const before=path.join(folder,'before'),after=path.join(folder,'after');
    const result=[];
    try{
      for(const [relative,encoded] of first){
        const old=encoded===null?null:Buffer.from(encoded,'base64');
        const current=await contents(await this.target(relative));
        if(hash(old)===hash(current))continue;
        await fs.writeFile(before,old??'');await fs.writeFile(after,current??'');
        let stat='';
        try{stat=(await git('git',['diff','--no-index','--numstat','--',before,after],{windowsHide:true})).stdout;}
        catch(e){if(e.code===1)stat=e.stdout??'';}
        const match=/^(\d+)\s+(\d+)/.exec(stat);
        result.push({relative,added:match?Number(match[1]):null,removed:match?Number(match[2]):null});
      }
    }finally{await Promise.all([fs.rm(before,{force:true}),fs.rm(after,{force:true})]);await fs.rmdir(folder);}
    return result;
  }
}
