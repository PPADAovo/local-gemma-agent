function subsetOf(next,approved){
 if(approved?.tool!=='plugin_call'||approved.path!==next.path)return false;
 const a=approved.args||{},b=next.args||{};
 const keys=new Set([...Object.keys(a),...Object.keys(b)]);
 let narrowed=false;
 for(const k of keys){
  if(Array.isArray(a[k])&&Array.isArray(b[k])){
   const allowed=new Set(a[k].map(x=>canonical(x)));
   if(!b[k].length||!b[k].every(x=>allowed.has(canonical(x))))return false;
   narrowed=true;
  }else if(canonical(a[k])!==canonical(b[k]))return false;
 }
 return narrowed;
}
const canonical=value=>JSON.stringify(value,(_key,item)=>item && typeof item==='object' && !Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
export class TaskApproval {
 request='';approved=[];denied=false;deniedKeys=new Set();approvedTools=new Set();
 reset(){this.request='';this.approved=[];this.denied=false;this.deniedKeys.clear();this.approvedTools.clear();}
 // 사용자가 승인 카드에서 "이번 작업 동안 이 서비스 작업 모두 승인"을 고르면, 같은 요청 안의 같은 도구 호출은 다시 묻지 않습니다.
 approveToolForTask(path){if(path)this.approvedTools.add(String(path));}
 async authorize(pending,ask,covers){
  if(this.request!==pending.request){this.reset();this.request=pending.request;}
  const key=canonical(pending.action?{action:pending.action}:{description:pending.description});
  if(this.deniedKeys.has(key))throw Error('사용자가 이 동작을 승인하지 않았습니다. 다른 방법을 선택하세요.');
  if(this.approved.some(entry=>entry.key===key))return;
  const act=pending.action;
  if(act?.tool==='plugin_call' && this.approvedTools.has(String(act.path)))return;
  // 승인한 서비스 호출을 다시 시도하면서 대상을 줄이기만 했다면(같은 도구, 목록이 승인 목록의 부분집합) 다시 묻지 않습니다.
  if(act?.tool==='plugin_call' && this.approved.some(entry=>subsetOf(act,entry.pending.action)))return;
  // 삭제처럼 되돌리기 어려운 동작은 비슷해 보이는 앞선 승인에 묻어가지 않습니다(정확히 같은 동작만 재사용).
  if(!pending.strict)for(const entry of this.approved){
   const scopes=['app','target','selectedHandle','observedHandle','selectedPid','window'];
   if(scopes.some(k=>canonical(entry.pending.action?.[k])!==canonical(pending.action?.[k])))continue;
   // A changed service payload must never inherit approval just because its prose looks similar.
   if(pending.action?.tool==='plugin_call' && entry.pending.action?.tool==='plugin_call' &&
      canonical(pending.action)!==canonical(entry.pending.action))continue;
   if(await covers(entry.pending,pending).catch(()=>false))return;
  }
  try{
   if(!await ask(pending))throw Error('사용자가 이 작업을 승인하지 않았습니다.');
  }catch(error){this.denied=true;this.deniedKeys.add(key);throw error;}
  this.approved.push({key,pending:structuredClone(pending)});
 }
}
