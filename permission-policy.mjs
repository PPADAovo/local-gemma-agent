// 권한 표: 작업 종류마다 세 모드(승인 요청 / 나 대신 승인 / 전체 권한)에서 물어볼지 정합니다.
// true = 승인 카드로 물음, false = 묻지 않고 실행, 'risky' = 위험해 보이는 경우만 물음(판단은 각 실행 지점).
// 비밀번호·결제·송금은 어떤 모드에서도 에이전트가 하지 않고 사용자가 직접 합니다(표에 없음).
export const PERMISSION_TABLE={
  'read':               {confirm:false,auto:false,  full:false},  // 파일 읽기·목록·화면 보기·창 목록
  'screen-record':      {confirm:true, auto:false,  full:false},  // 사용자가 녹화를 요청했을 때만 도구가 주어짐
  'file-create':        {confirm:true, auto:false,  full:false},  // 새 파일
  'file-modify':        {confirm:true, auto:true,   full:false},  // 원래 있던 파일 수정·덮어쓰기·이름 변경(백업됨)
  'file-delete':        {confirm:true, auto:true,   full:false},  // 삭제 도구(백업 → 실행 취소 가능)
  'command-delete':     {confirm:true, auto:true,   full:true},   // 명령으로 삭제(백업 없음, 되돌릴 수 없음)
  'command':            {confirm:true, auto:'risky',full:false},  // 명령 실행
  'app-control':        {confirm:true, auto:'risky',full:false},  // 클릭·입력 등 앱 조작
  'internet':           {confirm:true, auto:false,  full:false},  // 검색·페이지 읽기·브라우저 열기
  'send-or-service':    {confirm:true, auto:true,   full:false},  // 메일·메시지 보내기, 읽기 전용이 아닌 서비스 호출
  'publish':            {confirm:true, auto:true,   full:false}   // 사이트를 인터넷에 공개
};
export function needsApproval(kind,mode){
  const row=PERMISSION_TABLE[kind];
  if(!row)return true; // 표에 없는 종류는 안전하게 묻습니다.
  return row[['confirm','auto','full'].includes(mode)?mode:'auto'];
}
