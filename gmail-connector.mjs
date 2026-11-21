export const gmailSuggestions=[
  '최근 메일 대화 5개를 요약하고 결정 사항, 미결 질문, 다음 후속 조치를 정리해줘.',
  '감사인의 최신 이메일에 정중하지만 분명하게 답장 초안을 작성하고, 제공할 항목을 짧은 글머리표 목록으로 정리해줘.',
  '최근 고객 에스컬레이션 스레드를 담당자, 날짜, 이메일 참조가 포함된 실행 항목으로 정리해줘.'
];

export async function readGmailProfile(callTool){
  const raw=await callTool('',{name:'gmail.get_profile',args:{}});
  const profile=JSON.parse(raw);
  if(!profile||typeof profile!=='object'||Array.isArray(profile))throw Error('Gmail 프로필 응답이 올바르지 않습니다.');
  return profile;
}

export async function gmailDetailData(callTool){
  const profile=await readGmailProfile(callTool);
  const account=[profile.emailAddress,profile.email].find(value=>typeof value==='string'&&value.trim())||null;
  return {account,suggestions:gmailSuggestions};
}
