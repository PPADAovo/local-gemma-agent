const labels={
  find_free_tool:'무료 도구 찾기',generate_image:'외부 이미지 생성',lookup_word:'외부 사전 조회',
  final_reply:'최종 답변',
  discover_tools:'사용 가능한 도구 조회',project_check:'Node.js 구문 검사',media_convert:'FFmpeg 사진 변환',list:'폴더 목록',find_file:'파일 검색',read:'파일 읽기',write:'파일 저장',edit:'파일 편집',
  run:'터미널',run_js:'자바스크립트 실행',check_js:'문법 검사',calc:'계산기',open_file:'파일 열기',
  inspect_screen:'화면 읽기',capture:'화면 캡처',windows:'창 목록',focus:'창 전환',look:'화면 확인',click:'마우스 클릭',
  scroll:'스크롤',type:'키보드 입력',key:'단축키',drag:'마우스 드래그',open_app:'앱 실행',close_windows:'창 관리',
  browser_open:'작업 브라우저',browser_read:'웹페이지 읽기',browser_click:'웹페이지 클릭',browser_preview:'앱 미리보기',
  browser_capture:'웹페이지 캡처',web_search:'웹 검색',web_read:'웹 문서 읽기',skill:'스킬 설명서',plugin_search:'서비스 도구 검색',plugin_call:'서비스 도구',
  photo_search:'사진 검색',photo_save:'사진 저장',photo_view:'사진 확인',photo_background:'배경 편집',photo_cutout:'사진 누끼',
  make_ppt:'발표 자료',make_xlsx:'스프레드시트',open_image:'이미지 뷰어',rename_chat:'채팅 관리',canvas:'캔버스',schedule_add:'예약 도구'
};
export function toolLabel(tool){return labels[tool]||tool;}
const operational=tool=>tool && !['reply','plan','check','wait','review_result'].includes(tool);
// 시작 전에 "무엇을, 어떤 순서로, 무엇으로" 할지 사람 말투로 먼저 밝힙니다. 이후 단계 표시·계획 대조는 이 단계 목록을 기준으로 합니다.
export function announceWork(progress,tools,steps,{nickname='',goal=''}={}){
  const methods=[...new Set(tools.filter(operational))];
  const stages=steps.map(x=>String(x).trim()).filter(Boolean);
  if(!stages.length)return null;
  const method=methods.map(toolLabel).join('·');
  const phrase=method?method+' 도구를 이용해 ':'';
  const who=String(nickname||'').trim();
  const aim=String(goal||'').trim().replace(/[.。]\s*$/,'');
  const opening=(who?who+'씨, ':'')+(aim?aim+' — 이 작업을 ':'')+phrase+stages.length+'단계로 진행하겠습니다. 먼저 방법을 정하고, 실행한 뒤 결과를 직접 확인하겠습니다.';
  progress('작업 계획 · '+opening+'\n'+stages.map((s,i)=>(i+1)+'. '+s).join('\n'));
  return {methods,stages};
}
export function auditWork(progress,announced,events,complete,verification,stageChecks=[]){
  if(!announced)return;
  const succeeded=[...new Set(events.filter(e=>e.ok && operational(e.tool)).map(e=>e.tool))];
  const unused=announced.methods.filter(t=>!succeeded.includes(t));
  const extra=succeeded.filter(t=>!announced.methods.includes(t));
  const verificationText=verification?.criteria?.length?'완료 조건 '+verification.criteria.length+'개 검증':complete?'작업 완료':'완료 미확인';
  const parts=[verificationText,'실행 확인: '+(succeeded.map(toolLabel).join(' → ')||'없음')];
  if(unused.length)parts.push('계획 중 실행 미확인: '+unused.map(toolLabel).join('·'));
  if(extra.length && announced.methods.length)parts.push('계획 외 사용: '+extra.map(toolLabel).join('·'));
  const stages=announced.stages.map((stage,i)=>{
    const check=stageChecks?.[i];
    return (i+1)+'. '+stage+' — '+(check?.id && (check.id!==-1 || complete) && check.stage===stage?'확인 '+(check.id<0?'':'#'+check.id+' ')+toolLabel(check.tool)+' · '+check.quote:'실행 근거 미확인');
  });
  progress('계획 대조 · '+parts.join(' / ')+'\n'+stages.join('\n'));
}

export function requestedPlanApproval(input){
  const text=String(input).normalize('NFKC');
  return /(?:계획|절차|plan)[^.!?\n]{0,28}(?:승인|허락|approval)[^.!?\n]{0,24}(?:기다|받[고은아기]|전에는|후에|until|before)|(?:내가|제가)\s*(?:계획을?\s*)?(?:승인|허락)(?:하면|할 때까지)/i.test(text) &&
    !/(?:계획|절차)[^.!?\n]{0,20}(?:승인|허락)\s*(?:없이|필요 없|받지 마)/i.test(text);
}
export function planNotice(step){
  // Only classify a presentation/approval of the plan itself, not operational approvals or implementation work.
  const text=String(step).trim();
  return text.length<160 && /(?:계획|진행 절차|작업 절차|execution plan|work plan)/i.test(text) &&
    /(?:사용자|보고|안내|설명|알리|알림|제시|전달|승인|허락|approval|present|announce)/i.test(text) &&
    !/(?:파일에|파일로|\.md|\.txt|구현|설치|저장|다운로드|로그인|발송|테스트 실행|배포)/i.test(text);
}
