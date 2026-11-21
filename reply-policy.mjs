// Detect a request to repeat the prompt, not a genuine missing value or login action.
export function asksToRepeatRequest(value){
  const text=String(value??'');
  return /(?:다시|한\s*번\s*더|재차)[^\n.!?。]{0,100}(?:지시|명령|요청)(?:을|를)?\s*(?:해\s*주|하셔|하시|해줘)/i.test(text)
    || /(?:명령|요청|프롬프트)[^\n.!?。]{0,60}(?:다시|재입력|한\s*번\s*더)[^\n.!?。]{0,35}(?:입력|보내|작성|적어|말씀)(?:해)?\s*(?:주|하셔|하시)/i.test(text);
}
export const REPROMPT_CORRECTION='이미 받은 요청을 사용자에게 다시 지시하거나 재입력하라고 요구하지 마세요. 현재 요청과 실행 기록을 사용하세요. 사용자가 실행을 요청했다면 확인된 결과 다음의 남은 작업을 도구로 진행하고, 설명만 요청했다면 설명만 답하세요. 사용자에게는 실제로 누락된 필수 정보나 로그인·잠금 해제 등 직접 해야 하는 조치만 구체적으로 물으세요. 도구 오류가 해결되지 않으면 확인된 실패와 남은 작업을 사실대로 보고하고, 성공했다고 하지 마세요.';
export const REPROMPT_FAILURE='작업 완료를 확인하지 못했습니다. 기존 요청을 활용해 다음 동작을 결정하지 못해 중단했습니다. 같은 명령을 다시 입력하실 필요는 없습니다. 실행된 내용은 작업 기록에서 확인할 수 있습니다.';
