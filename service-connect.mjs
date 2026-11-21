// 연결되지 않은 서비스가 필요한 요청을 실패로 끝내지 않고 연결 방법을 안내합니다.
// 로그인·권한 허용·확장 설치는 언제나 사용자가 직접 하고, 연결 여부는 실제 상태를 다시 조회해 확인합니다.

// slug: Codex 플러그인 이름, prefix: 연결된 도구 이름 앞부분, site: 연결 대신 열 수 있는 로컬 사이트 도구
export const SERVICES=[
  {slug:'gmail',name:'Gmail',words:/gmail|지메일/i,site:'local.gmail.open'},
  {slug:'google-drive',name:'Google Drive',words:/google\s*drive|구글\s*드라이브|드라이브/i,site:'local.google-drive.open'},
  {slug:'google-calendar',name:'Google Calendar',words:/google\s*calendar|구글\s*캘린더|캘린더/i,site:'local.google-calendar.open'},
  {slug:'github',name:'GitHub',words:/github|깃허브/i,site:'local.github.open'},
  {slug:'notion',name:'Notion',words:/notion|노션/i},
  {slug:'slack',name:'Slack',words:/slack|슬랙/i,site:'local.slack.open'},
  {slug:'outlook-email',name:'Outlook',words:/outlook|아웃룩/i,site:'local.outlook-email.open'},
  {slug:'dropbox',name:'Dropbox',words:/dropbox|드롭박스/i,site:'local.dropbox.open'},
  {slug:'hubspot',name:'HubSpot',words:/hubspot|허브스팟/i,site:'local.hubspot.open'}
].map(service=>({...service,prefix:service.slug.replaceAll('-','_')+'.'}));

export function findService(text){
  const value=String(text||'');
  return SERVICES.find(service=>service.words.test(value))||null;
}

const toolName=item=>typeof item==='string'?item:item?.name;
// 검색 결과에 이 서비스의 실제 연결 도구가 있으면 이미 연결된 것입니다. (local.* 사이트 열기와 내장 발송 도구는 제외)
export function hasConnectedTools(service,found){
  return (Array.isArray(found)?found:[]).some(item=>{
    const name=String(toolName(item)||'');
    if(item && typeof item==='object' && item.builtin)return false;
    // 빈 검색은 연결된 서비스 이름 목록(gmail, google_drive …)을 돌려줍니다.
    return name.startsWith(service.prefix) || name===service.prefix.slice(0,-1);
  });
}

export const isHttpsUrl=value=>{
  if(typeof value!=='string')return false;
  try{const url=new URL(value);return url.protocol==='https:' && !!url.hostname;}catch{return false;}
};

export const CONNECT='연결하기', ENABLE='켜기', DONE='연결을 마쳤어요', SITE='사이트를 열어 직접 진행', STOP='작업 중지';
export const EXTENSION='작업 탭 확장 연결', CONTINUE='그냥 진행';

// 상태에 맞는 첫 카드를 만듭니다. status: {installed, enabled, connected, url} 또는 null(조회 실패)
export function connectionCard(service,status){
  const options=[];
  let question;
  if(status && status.installed && !status.enabled){
    question=service.name+' 연결이 꺼져 있어 이 작업을 바로 할 수 없어요. [켜기]를 누르면 다시 켜고 이어서 진행해요.';
    options.push(ENABLE);
  }else if(status && isHttpsUrl(status.url)){
    question=service.name+'이(가) 아직 연결되지 않아 이 작업을 바로 할 수 없어요. [연결하기]를 누르면 브라우저에 로그인·권한 화면이 열려요. 로그인과 권한 허용은 직접 해 주세요.';
    options.push(CONNECT);
  }else{
    question=service.name+' 연결 상태를 확인하지 못했어요.'+(service.site?' 사이트를 열어 화면을 보며 진행할 수는 있어요(느리고 로그인이 필요할 수 있어요).':'');
  }
  if(service.site)options.push(SITE);
  options.push(STOP);
  return {kind:'connect',title:service.name+' 연결 필요',question,choicesOnly:true,options};
}

// 연결 안내 전체 흐름. 결과:
//  {connected:true}                 → 다시 검색하면 실제 도구가 나옵니다.
//  {fallback:'local.x.open', note}  → 연결 대신 사이트를 열어 진행합니다.
//  {stop:true, message}             → 사용자가 멈췄거나 연결이 확인되지 않았습니다.
export async function guideConnection({service,getStatus,ask,openUrl,enable,hasWorkTab,openExtensionSetup,progress=()=>{}}){
  let status=null;
  try{status=await getStatus(service.slug);}catch{}
  if(status?.connected && status?.enabled!==false)return {connected:true};
  progress(service.name+' 연결이 필요합니다.');
  const choice=await ask(connectionCard(service,status));
  if(choice===ENABLE){
    await enable(service.slug);
    let after=null;try{after=await getStatus(service.slug);}catch{}
    if(after?.connected)return {connected:true};
    if(after && isHttpsUrl(after.url))return guideConnection({service,getStatus:async()=>after,ask,openUrl,enable,hasWorkTab,openExtensionSetup,progress});
    return {stop:true,message:service.name+'을(를) 켰지만 연결된 도구가 확인되지 않았어요. 플러그인 화면에서 연결 상태를 확인해 주세요.'};
  }
  if(choice===CONNECT){
    // 브라우저에서 계정을 연결해도 이 PC에 플러그인이 설치·활성화돼 있어야 도구가 생깁니다. 사용자가 누른 [연결하기]에만 함께 처리합니다.
    if(enable && (!status.installed || !status.enabled))await enable(service.slug);
    await openUrl(status.url);
    for(let attempt=0;attempt<2;attempt++){
      const next=await ask({kind:'connect',title:service.name+' 연결 대기',question:'브라우저에서 로그인과 권한 허용을 마친 뒤 아래 버튼을 눌러 주세요.',choicesOnly:true,options:[DONE,STOP]});
      if(next!==DONE)break;
      let after=null;try{after=await getStatus(service.slug);}catch{}
      if(after?.connected && after?.enabled!==false)return {connected:true};
      progress(service.name+' 연결이 아직 확인되지 않았습니다.');
    }
    return {stop:true,message:service.name+' 연결이 확인되지 않아 작업을 멈췄어요. 연결을 마친 뒤 다시 요청해 주세요.'};
  }
  if(choice===SITE && service.site){
    if(hasWorkTab && !(await hasWorkTab().catch(()=>false))){
      const extension=await ask({kind:'connect',title:'작업 탭 확장 프로그램',
        question:'사이트를 화면으로 조작하려면 Chrome에 "Gemma 작업 탭" 확장 프로그램을 연결하는 게 좋아요. 연결하면 로그인된 내 브라우저 탭에서 작업해요. 설치 안내 창을 열까요?',
        choicesOnly:true,options:[EXTENSION,CONTINUE,STOP]});
      if(extension===STOP)return {stop:true,message:'요청에 따라 작업을 멈췄어요.'};
      if(extension===EXTENSION && openExtensionSetup)await openExtensionSetup();
    }
    return {fallback:service.site,note:service.name+'이(가) 연결되지 않아 사용자가 사이트를 열어 직접 진행하기로 했습니다. '+service.site+'로 사이트를 열고 화면을 보며 진행하세요. 로그인이 필요하면 사용자에게 맡기세요.'};
  }
  return {stop:true,message:'요청에 따라 작업을 멈췄어요.'};
}
