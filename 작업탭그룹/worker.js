// Loaded only into the temporary browser profile owned by browser-owner.mjs.
let label,enabled=false,queue=Promise.resolve();
const groups=new Map();
const owned=new Set();
let rootSeen=false;
async function regroup(){
  if(!enabled)return;
  for(const w of await chrome.windows.getAll({populate:true})){
    if(w.type!=='normal'||!w.tabs?.length)continue;
    let group=groups.get(w.id);
    if(group!==undefined && !w.tabs.some(t=>t.groupId===group))group=undefined;
    const ids=w.tabs.filter(t=>owned.has(t.id) && t.groupId!==group && t.groupId===chrome.tabGroups.TAB_GROUP_ID_NONE).map(t=>t.id);
    if(ids.length)group=await chrome.tabs.group(group===undefined?{tabIds:ids}:{tabIds:ids,groupId:group});
    if(group!==undefined){groups.set(w.id,group);await chrome.tabGroups.update(group,label);}
  }
}
const schedule=()=>queue=queue.catch(()=>{}).then(regroup);
chrome.tabs.onCreated.addListener(t=>{
  if(!enabled)return;
  if(!rootSeen || owned.has(t.openerTabId)){
    rootSeen=true;owned.add(t.id);schedule();
  }
});
chrome.tabs.onUpdated.addListener((_id,change)=>{if(change.status==='complete')schedule();});
chrome.runtime.onInstalled.addListener(()=>{});
globalThis.startGroups=async value=>{label=value;enabled=true;await schedule();};
globalThis.endGroups=async()=>{
  enabled=false;await queue.catch(()=>{});
  for(const groupId of groups.values()){
    const tabs=await chrome.tabs.query({groupId});
    const ids=tabs.map(t=>t.id).filter(id=>owned.has(id));
    if(ids.length)await chrome.tabs.ungroup(ids);
  }
  groups.clear();
};
