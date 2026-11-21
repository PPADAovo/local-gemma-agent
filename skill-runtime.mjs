// 스킬이 이 앱(로컬 모델 + 이 PC의 도구)에서 실제로 되는지 구분합니다.
//  local      : 파일·명령·화면·브라우저 등 이 PC의 도구만으로 됨
//  connector  : 연결된 서비스(GitHub·Gmail·Notion·Google Drive)를 plugin_call로 써야 됨
//  unsupported: Codex 전용 기능(훅·자동화·리뷰 봇·SDK·CLI/Cursor 설정·OpenAI 이미지 API)이 필요하거나,
//               같은 일을 하는 로컬 스킬이 따로 있어 중복인 것 → 에이전트에게 보여 주지 않음
const UNSUPPORTED={
  'create-hook':'Codex 이벤트 훅 설정 전용',
  'migrate-to-skills':'Codex 규칙·명령 변환 전용',
  'origin':'Codex 호스팅 저장소 도구 전용',
  'review':'Codex 리뷰 에이전트 필요 (로컬: review-security, systematic-debugging)',
  'review-bugbot':'Bugbot 서비스 필요',
  'review-agent':'Codex 리뷰 에이전트 필요',
  'sdk':'Codex 계정·SDK 실행 환경 필요',
  'statusline':'Codex CLI 화면 설정 전용',
  'update-cli-config':'Codex CLI 설정 전용',
  'update-cursor-settings':'Cursor·VS Code 설정 전용',
  'openai-docs':'OpenAI 문서 연결 필요',
  'imagegen':'OpenAI 이미지 API 필요 (로컬: image-gen)',
  'spreadsheets:excel-live-control':'Excel 추가 기능 연결 필요',
  'documents:documents':'로컬 documents 스킬과 중복',
  'pdf:pdf':'로컬 pdf 스킬과 중복',
  'presentations:presentations':'로컬 presentations 스킬과 중복',
  'spreadsheets:spreadsheets':'로컬 spreadsheets 스킬과 중복',
  'template-creator:template-creator':'로컬 template-creator 스킬과 중복',
  'visualize:visualize':'로컬 visualize 스킬과 중복',
  'hatch-pet':'Codex 펫 패키지 전용'
};
const CONNECTOR={github:'GitHub',autopilot:'GitHub','github-code':'GitHub','new-repo':'GitHub',share:'GitHub','split-to-prs':'GitHub','skill-installer':'GitHub',
  'gmail-attachments':'Gmail',notion:'Notion'};

export function classifySkill(skill){
  const name=String(skill?.name||'').toLowerCase();
  if(UNSUPPORTED[name])return {runtime:'unsupported',reason:UNSUPPORTED[name]};
  if(name.startsWith('cloud-environment:'))return {runtime:'unsupported',reason:'관리형 클라우드 데스크톱 전용 (로컬: computer-use:computer-use)'};
  const remote=name.startsWith('work-pets:')?'Pets':name.startsWith('pages:')?'ChatGPT Space':name.startsWith('sites:')?'Sites':name.startsWith('plugin-creator:')?'Plugin Creator':name.startsWith('write-like-me:')?'Writing Style':'';
  if(remote)return {runtime:'connector',reason:remote+' 연결 도구 필요'};
  const service=CONNECTOR[name]||(name.startsWith('notion:')?'Notion':name.startsWith('google-drive:')?'Google Drive':name.startsWith('gmail')?'Gmail':'');
  if(service)return {runtime:'connector',reason:service+' 연결 필요'};
  return {runtime:'local',reason:'이 PC의 도구로 실행'};
}
export const RUNTIME_LABEL={local:'로컬 모델 가능',connector:'연결 서비스 필요',unsupported:'이 앱에서 안 됨'};
