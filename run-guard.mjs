// run(터미널 명령)으로 화면을 조작하거나 브라우저 창을 띄우는 것을 막습니다.
// 명령으로 다른 프로그램의 버튼을 누르거나 창을 닫으면 '대상 창'·승인 안전장치를 건너뛰게 되고,
// 웹 파일을 Start-Process 같은 명령으로 열면 Windows 기본 브라우저(엣지일 수 있음)가 뜹니다.
// 돌려주는 값: 막아야 하면 모델에게 보여 줄 안내 문장, 아니면 ''.
export function runScreenGuard(command,edgeRequested=false){
  const text=String(command??'');
  // 1) UI 자동화로 다른 프로그램의 화면을 누르거나 닫는 스크립트
  if(/UIAutomationClient|System\.Windows\.Automation|AutomationElement|InvokePattern|WindowPattern|ValuePattern|SelectionItemPattern|\[System\.Windows\.Forms\.Cursor\]|SetCursorPos|PostMessage|SendMessage|CloseMainWindow/i.test(text))
    return '화면의 버튼을 누르거나 창을 닫는 일은 명령(run)으로 하지 않습니다. 웹 페이지는 browser_preview·browser_click·browser_read로, 프로그램 창은 look·click·type·key 도구로 조작하세요.';
  // 2) 엣지를 직접 실행(사용자가 엣지를 요청한 경우는 허용)
  if(!edgeRequested && /(?:^|[\s"'&;|(\\/])msedge(?:\.exe)?\b|microsoft-edge:/i.test(text))
    return '엣지는 쓰지 않습니다. 웹 파일이나 주소는 open_file(크롬으로 열림) 또는 browser_preview·browser_open으로 여세요.';
  // 3) 웹 파일·주소를 기본 프로그램으로 열기(기본 브라우저가 엣지일 수 있음)
  const opener=/(?:^|[;&|(\s])(?:Start-Process|saps|start|Invoke-Item|ii|explorer(?:\.exe)?|cmd(?:\.exe)?\s+\/c\s+start|rundll32(?:\.exe)?\s+url\.dll)\b/i;
  const webTarget=/\.(?:html?|xhtml|svg|url)(?:["'\s)]|$)|https?:\/\/|file:\/\//i;
  if(opener.test(text) && webTarget.test(text) && !/\bchrome(?:\.exe)?\b/i.test(text))
    return '웹 파일이나 주소를 명령으로 열면 기본 브라우저(엣지일 수 있음)가 뜹니다. open_file(크롬으로 열림) 또는 browser_preview·browser_open을 쓰세요.';
  return '';
}
