// Learn which observations helped recover from a failed action. Samples contain
// only fixed context labels, tool identifiers and a binary outcome per episode.
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

const surfaces=new Set(['web','desktop','other','selected-window']);
const accessTypes=new Set(['operate','observe','unknown']);
const observations=new Set([
  'list','read','find_file','look','windows','browser_read','web_read','web_search',
  'skill','plugin_search','calc','schedule_list','recall'
]);
const actions=new Set([...observations,'open_file','open_app','browser_open','browser_click',
  'browser_scroll','browser_back','browser_preview','click','scroll','focus','write','edit',
  'make_xlsx','make_ppt','canvas','media_search','media_cutout']);
const bookkeeping=new Set(['reply','plan','check','wait','review_result']);
const policyFile=/^v2-\d{13}-[0-9a-f-]{36}\.json$/;
const retention=256;
const episodeIds=new WeakMap();

export function actionContext(spec,selected){
  const surface=selected?'selected-window':spec?.surface;
  return (surfaces.has(surface)?surface:'other')+'/'+(accessTypes.has(spec?.access)?spec.access:'unknown');
}
function validContext(context){
  if(typeof context!=='string')return false;
  const [surface,access,...rest]=context.split('/');
  return !rest.length && surfaces.has(surface) && accessTypes.has(access);
}

// A recovery may inspect an already permitted target. This policy never elects
// an editor, a sender, a login action, a credential entry, or a shell command.
export function isRecoveryObservation(tool){return observations.has(tool);}

function proofIds(events,receipt){
  const proof=new Set();
  if(!Array.isArray(receipt?.criteria) || !receipt.criteria.length || !Array.isArray(receipt.evidence))return proof;
  for(const ref of receipt.evidence){
    if(!Number.isSafeInteger(ref?.id) || ref.id<1)return new Set();
    const event=events[ref.id-1];
    if(event?.ok!==true || event.tool!==ref.tool || !(event.observation||event.desktopProof) ||
       (ref.path!==undefined && ref.path!==(event.path||'')))return new Set();
    proof.add(ref.id);
  }
  return proof;
}

export async function learnEpisode(directory,context,events,receipt){
  if(!directory || !validContext(context))return;
  const proof=proofIds(events,receipt);
  if(!proof.size)return;
  const steps=events.map((event,i)=>({event,id:i+1})).filter(s=>!bookkeeping.has(s.event.tool));
  const samples=[];
  const seen=new Set();
  for(let i=1;i<steps.length;i++){
    const previous=steps[i-1].event, current=steps[i], next=steps[i+1];
    if(previous.ok!==false || !actions.has(previous.tool) || !observations.has(current.event.tool))continue;
    // The verified result can be the observation itself or its immediate
    // successful follow-up (e.g. list a directory, then read the found file).
    const verified=proof.has(current.id) || (next?.event.ok===true && proof.has(next.id));
    if(current.event.ok!==false && !(current.event.ok===true && verified))continue;
    const key=previous.tool+'/'+current.event.tool;
    if(seen.has(key))continue;
    seen.add(key);
    samples.push([previous.tool,current.event.tool,current.event.ok?1:0]);
  }
  if(!samples.length)return;
  let id=episodeIds.get(events);
  if(!id){id=Date.now()+'-'+randomUUID();episodeIds.set(events,id);}
  await fs.mkdir(directory,{recursive:true});
  try{
    await fs.writeFile(path.join(directory,'v2-'+id+'.json'),JSON.stringify({context,samples}),{flag:'wx'});
  }catch(error){if(error.code==='EEXIST')return;throw error;}
  const files=(await fs.readdir(directory)).filter(f=>policyFile.test(f)).sort();
  await Promise.all(files.slice(0,Math.max(0,files.length-retention)).map(f=>fs.rm(path.join(directory,f),{force:true})));
}

export async function rankRecoveryTools(directory,context,previous,choices){
  if(!directory || !validContext(context) || !actions.has(previous))return [];
  const files=(await fs.readdir(directory).catch(()=>[])).filter(f=>policyFile.test(f)).sort().slice(-retention);
  const allowed=new Set(choices.filter(isRecoveryObservation)), totals=new Map();
  for(const file of files){
    let sample;
    try{sample=JSON.parse(await fs.readFile(path.join(directory,file),'utf8'));}catch{continue;}
    if(sample.context!==context || !Array.isArray(sample.samples))continue;
    const counted=new Set();
    for(const row of sample.samples){
      if(!Array.isArray(row) || row.length!==3)continue;
      const [failed,tool,won]=row;
      if(failed!==previous || !allowed.has(tool) || ![0,1].includes(won) || counted.has(tool))continue;
      counted.add(tool);
      const total=totals.get(tool)||{tool,wins:0,support:0};
      total.wins+=won;total.support++;totals.set(tool,total);
    }
  }
  return [...totals.values()].filter(r=>r.support>=2)
    .map(r=>({...r,score:(r.wins+1)/(r.support+2)})).sort((a,b)=>b.score-a.score);
}
