import {appDataDir} from './app-data.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
const dir=()=>path.join(appDataDir(),'skills');
const key=name=>createHash('sha256').update(name).digest('hex')+'.json';
export async function skillOverrides(){
 const entries=await fs.readdir(dir()).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
 const rows=await Promise.all(entries.filter(f=>/^[a-f0-9]{64}\.json$/.test(f)).map(async f=>{
   try{return JSON.parse(await fs.readFile(path.join(dir(),f),'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}
 }));
 return new Map(rows.filter(Boolean).map(r=>[r.name,r.state]));
}
export async function setSkillState(name,state){
 if(typeof name!=='string'||!name.trim()||!['enabled','disabled','removed'].includes(state))throw Error('스킬 이름과 상태를 확인하세요.');
 const folder=dir(),file=path.join(folder,key(name));
 if(state==='enabled'){await fs.rm(file,{force:true});return {name,state};}
 await fs.mkdir(folder,{recursive:true});const tmp=path.join(folder,randomUUID()+'.tmp');
 try{await fs.writeFile(tmp,JSON.stringify({name,state}),{flag:'wx'});await fs.rename(tmp,file);}finally{await fs.rm(tmp,{force:true});}
 return {name,state};
}
