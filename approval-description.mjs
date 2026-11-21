// Approval text describes the pending operation, never the raw tool payload.
const technical=/```|\b(?:Remove-Item|Write-Output|Invoke-Expression|Start-Process|inputSchema|browser_[a-z_]+|plugin_call)\b|\blocal\.[a-z-]+\.[a-z_]+\b|\{\s*"/i;
const quoted=value=>'“'+String(value)+'”';
export async function approvalDescription(action,explain){
 const {tool,elementName,text='',path='',args={}}=action;
 if(tool==='plugin_call' && path==='gmail.send_attached_email'){
  return ['Gmail에서 아래 메일을 발송합니다.','받는 사람: '+(args.to==='me'?'내 Gmail 주소':args.to),
   '제목: '+args.subject,'본문: '+args.body,'첨부 파일: '+((args.files||[]).join(', ')||'없음'),
   '승인하면 '+(args.files?.length?'본문과 첨부 파일이':'메일 본문이')+' 받는 사람에게 전송됩니다.'].join('\n');
 }
 if(tool==='plugin_call' && action.localService){
  return path==='local.gmail.important'?'Gmail의 중요 메일 목록에서 보이는 제목을 확인합니다.':action.localService+' 웹사이트를 브라우저에서 엽니다. 작업이 끝나도 창을 열어 둡니다.';
 }
 const verbs={click:'클릭',double_click:'두 번 클릭',right_click:'마우스 오른쪽 버튼으로 클릭',browser_click:'클릭'};
 if(verbs[tool] && elementName)return quoted(elementName)+' 항목을 '+verbs[tool]+'합니다.';
 if(['type','browser_type'].includes(tool) && elementName && !technical.test(text))return quoted(elementName)+' 입력란에 다음 내용을 입력합니다.\n'+text;
 if(tool==='open_app')return quoted(text)+' 앱을 실행합니다.';
 if(tool==='focus')return quoted(text)+' 창을 앞으로 가져옵니다.';
 if(tool==='browser_snapshot')return '현재 브라우저 화면의 내용과 버튼을 확인합니다.';
 if(tool==='browser_navigate' && args.url)return '브라우저에서 다음 페이지를 엽니다.\n'+args.url;
 let description;
 try{description=await explain(action);}catch{}
 if(!description || !['work','target','effect'].every(key=>typeof description[key]==='string' && description[key].trim()) ||
    technical.test(description.work+'\n'+description.effect) || !/[가-힣]/.test(description.work))
  throw Error('승인에 필요한 작업 내용을 명확하게 설명하지 못해 실행하지 않았습니다. 대상과 변경 내용을 확인해 다시 시도하세요.');
 return '할 작업: '+description.work.trim()+'\n대상: '+description.target.trim()+'\n승인하면: '+description.effect.trim();
}
