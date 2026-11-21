// 여러 서비스 호출을 한 번에 끝내는 "작업 단위" 도구입니다.
// 근거: Anthropic "Writing effective tools for agents" — list_* 여러 개 대신 목적 단위 도구 하나(schedule_event 등)가
// 에이전트의 실수와 토큰을 줄인다. 작은 로컬 모델은 단계가 늘수록 실패가 누적되므로(단계당 95%면 8단계 ≈ 66%) 특히 효과가 큽니다.

export const UPCOMING_EVENTS={
  name:'google_calendar.upcoming_events',
  builtin:true,
  description:'구글 캘린더의 다가오는 일정을 모든 내 캘린더에서 모아 시간순으로 돌려줍니다. "일정 N개 알려줘", "이번 주 일정" 같은 요청은 이 도구 하나로 끝납니다. 입력: count(개수, 기본 10), days(며칠 앞까지, 기본 30), query(제목 검색어, 선택), include_holidays(공휴일 포함, 기본 false).',
  inputSchema:{type:'object',properties:{count:{type:'integer'},days:{type:'integer'},query:{type:'string'},include_holidays:{type:'boolean'}}},
  annotations:{readOnlyHint:true,destructiveHint:false}
};

const HOLIDAY=/#holiday@group\.v\.calendar\.google\.com$/;

export async function upcomingEvents(args={},call,now=new Date()){
  const count=Math.min(50,Math.max(1,Number.parseInt(args.count??10,10)||10));
  const days=Math.min(365,Math.max(1,Number.parseInt(args.days??30,10)||30));
  const timeMin=now.toISOString(),timeMax=new Date(now.getTime()+days*86400000).toISOString();
  const listed=JSON.parse(await call('',{name:'google_calendar.list_calendars',args:{max_results:100}}));
  const calendars=(listed.calendars||[]).filter(c=>args.include_holidays||!HOLIDAY.test(c.id));
  const ids=calendars.length?calendars.map(c=>c.id):['primary'];
  const names=new Map(calendars.map(c=>[c.id,c.summary]));
  const results=await Promise.allSettled(ids.map(async id=>{
    const found=JSON.parse(await call('',{name:'google_calendar.search_events',args:{calendar_id:id,time_min:timeMin,time_max:timeMax,timezone_str:'Asia/Seoul',max_results:count,...(args.query?{query:String(args.query)}:{})}}));
    return (found.events||[]).filter(e=>e.status!=='cancelled').map(e=>({title:e.summary||'(제목 없음)',start:e.start,end:e.end,location:e.location||undefined,calendar:names.get(id)||id,url:e.url}));
  }));
  const failed=results.filter(r=>r.status==='rejected').length;
  if(failed===results.length)throw Error('캘린더 일정을 하나도 읽지 못했습니다: '+String(results[0]?.reason?.message||'').slice(0,300));
  const events=results.flatMap(r=>r.status==='fulfilled'?r.value:[]).sort((a,b)=>String(a.start).localeCompare(String(b.start))).slice(0,count);
  return JSON.stringify({window:{from:timeMin,to:timeMax,timezone:'Asia/Seoul'},calendars:ids.length,unreadCalendars:failed,count:events.length,events});
}

// 메일 정리: 작은 모델이 메일을 한 통씩 읽고 ID를 기억해 지우면, 대화 압축 뒤 ID가 섞여 "보존"으로 판단한 메일까지 지웁니다
// (2026-11-19 로그: GitHub 보안 알림·카카오 개인정보 안내가 삭제됨). 그래서 분류와 삭제 목록을 앱이 들고 있고,
// 모델은 미리보기 → 확인 → 적용 두 번만 부릅니다. 적용은 미리보기에 있던 ID만, 보존 판정은 지우지 않습니다.
export const INBOX_CLEANUP={
  name:'gmail.inbox_cleanup',
  builtin:true,
  description:'받은편지함 정리(광고·뉴스레터 삭제, 중요 메일 보존)를 한 번에 처리합니다. 메일을 한 통씩 읽거나 ID를 직접 모아 delete_emails를 부르지 마세요. '+
    '1) mode="preview": 받은편지함 전체를 읽어 delete(삭제 예정)·keep(보존: 보안·로그인·결제·카드·주문·개인정보·별표·내가 보낸 메일)·unsure(판단 보류) 목록과 plan_id를 돌려줍니다. 아무것도 지우지 않습니다. '+
    '2) 목록을 사용자에게 보여 준 뒤 mode="apply", plan_id=<미리보기 plan_id>로 delete 목록 전체를 휴지통으로 한 번에 옮기고 결과를 확인합니다. '+
    'keep=[id…]로 삭제에서 뺄 수 있고 also_delete=[id…]로 미리보기의 unsure 메일을 추가할 수 있습니다. query로 범위를 바꿀 수 있습니다(기본 "in:inbox").',
  inputSchema:{type:'object',properties:{mode:{type:'string',enum:['preview','apply']},plan_id:{type:'string'},query:{type:'string'},max_messages:{type:'integer'},keep:{type:'array',items:{type:'string'}},also_delete:{type:'array',items:{type:'string'}}},required:['mode']},
  annotations:{readOnlyHint:false,destructiveHint:true}
};

const KEEP_WORDS=/보안|security|로그인|log.?in|sign.?in|비밀번호|password|인증|verif|2단계|otp|본인\s*확인|결제|payment|영수증|receipt|invoice|청구|billing|카드|card|명세서|statement|주문|order|배송|shipping|delivery|환불|refund|은행|bank|세금|tax|계약|contract|개인정보|privacy|이용내역|소멸|만료|expir|해지|탈퇴|계정.*(보호|잠금|정지|공유)|account.*(lock|suspend|alert)/i;
const AD_WORDS=/광고|\(ad\)|newsletter|뉴스레터|weekly|digest|소식지|할인|sale|%\s*off|쿠폰|coupon|특가|프로모션|promo|이벤트|webinar|웨비나|신상품|무료\s*체험|free\s*trial|recommend|추천|공개:|now available|what'?s new|update(s)?\s+(for|from)|이번\s*주|오늘의/i;
const BULK_SENDER=/^(news|newsletter|marketing|promo|offers?|deals?|info|hello|hi|team|updates?|event|webmaster|noreply|no-reply|donotreply)[@.]|@(news|mail|email|e|em|updates|marketing|members|campaign)\./i;
const text=value=>String(value??'');
export function classifyEmail(message){
  const labels=Array.isArray(message.labels)?message.labels:Array.isArray(message.label_ids)?message.label_ids:[];
  const from=text(message.from_||message.from||message.sender);
  const subject=text(message.subject);
  // 본문(snippet)은 보지 않습니다. 사용자 이름이 "계정"이면 광고 본문의 "Dear 계정"만으로 보존되는 일이 생깁니다.
  if(labels.includes('STARRED'))return {decision:'keep',reason:'별표'};
  if(labels.includes('SENT'))return {decision:'keep',reason:'내가 보낸 메일'};
  if(KEEP_WORDS.test(subject))return {decision:'keep',reason:'보안·결제·계정 관련 제목'};
  if(labels.includes('CATEGORY_PROMOTIONS'))return {decision:'delete',reason:'프로모션 분류'};
  if(AD_WORDS.test(subject))return {decision:'delete',reason:'광고·뉴스레터 제목'};
  if(labels.includes('CATEGORY_SOCIAL')&&BULK_SENDER.test(from))return {decision:'delete',reason:'소셜 알림'};
  if(labels.includes('IMPORTANT'))return {decision:'unsure',reason:'Gmail이 중요로 표시'};
  return {decision:'unsure',reason:'판단 근거 부족'};
}

const brief=(m,c)=>({id:m.id,from:text(m.from_||m.from||m.sender).slice(0,60),subject:text(m.subject).slice(0,80),reason:c.reason});
let planCounter=0;
export async function inboxCleanup(args={},call,store){
  if(!(store instanceof Map))throw Error('정리 계획 저장소가 없습니다.');
  if(args.mode==='preview'){
    const query=text(args.query).trim()||'in:inbox';
    const limit=Math.min(1000,Math.max(1,Number.parseInt(args.max_messages??500,10)||500));
    const seen=new Map();let token='';
    do{
      const page=JSON.parse(await call('',{name:'gmail.search_emails',args:{query,max_results:Math.min(100,limit),...(token?{next_page_token:token}:{})}}));
      for(const m of page.emails||[])if(m?.id&&!seen.has(m.id))seen.set(m.id,m);
      token=page.next_page_token||'';
    }while(token&&seen.size<limit);
    const plan={query,delete:[],keep:[],unsure:[],all:new Map()};
    for(const m of seen.values()){const c=classifyEmail(m);plan[c.decision].push(brief(m,c));plan.all.set(m.id,c.decision);}
    const plan_id='cleanup-'+(++planCounter)+'-'+Date.now().toString(36);
    store.set(plan_id,plan);
    return JSON.stringify({plan_id,query,scanned:seen.size,truncated:!!token,counts:{delete:plan.delete.length,keep:plan.keep.length,unsure:plan.unsure.length},
      delete:plan.delete,keep:plan.keep,unsure:plan.unsure,
      next:'아직 아무것도 지우지 않았습니다. 삭제 예정·보존·보류 목록을 사용자에게 요약해 보여 주고, mode="apply", plan_id="'+plan_id+'"로 한 번에 적용하세요.'});
  }
  if(args.mode!=='apply')throw Error('mode는 "preview" 또는 "apply"입니다. 먼저 preview로 목록을 만드세요.');
  const plan=store.get(text(args.plan_id));
  if(!plan)throw Error('이 plan_id의 미리보기가 없습니다. 먼저 mode="preview"로 정리 목록을 만드세요.');
  const keep=new Set(Array.isArray(args.keep)?args.keep.map(text):[]);
  const extra=Array.isArray(args.also_delete)?args.also_delete.map(text):[];
  for(const id of extra){
    if(!plan.all.has(id))throw Error(id+'는 미리보기 목록에 없는 ID입니다. 미리보기 결과의 id만 쓰세요.');
    if(plan.all.get(id)==='keep')throw Error(id+'는 보존(보안·결제·계정 등)으로 판정된 메일이라 지우지 않습니다. 정말 지워야 하면 사용자가 Gmail에서 직접 지우도록 안내하세요.');
  }
  const ids=[...new Set([...plan.delete.map(m=>m.id).filter(id=>!keep.has(id)),...extra])];
  const failed=[];let trashed=0;
  for(let i=0;i<ids.length;i+=50){
    const chunk=ids.slice(i,i+50);
    const result=JSON.parse(await call('',{name:'gmail.delete_emails',args:{message_ids:chunk}}));
    for(const r of result.responses||[]){if(r.success)trashed++;else failed.push({id:r.message_id,error:r.error||r.detail||'실패'});}
  }
  // 적용 결과를 응답만 믿지 않고 받은편지함을 다시 읽어 확인합니다.
  const remaining=new Set();let token='';
  do{
    const page=JSON.parse(await call('',{name:'gmail.search_email_ids',args:{query:plan.query,max_results:500,...(token?{next_page_token:token}:{})}}));
    for(const id of page.message_ids||[])remaining.add(id);
    token=page.next_page_token||'';
  }while(token&&remaining.size<5000);
  const still_in_inbox=ids.filter(id=>remaining.has(id));
  store.delete(text(args.plan_id));
  return JSON.stringify({status:still_in_inbox.length||failed.length?'일부 미완료':'정리 완료(휴지통으로 이동, 30일 안에 복구 가능)',
    requested:ids.length,trashed,failed,still_in_inbox,kept_untouched:plan.all.size-ids.length});
}
