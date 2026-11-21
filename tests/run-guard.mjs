import test from 'node:test';
import assert from 'node:assert/strict';
import {runScreenGuard} from '../run-guard.mjs';

test('scripts that press or close other programs through UI automation are refused',()=>{
  assert.match(runScreenGuard("Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes; $el=[System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]7736988)"),/browser_preview/);
  assert.match(runScreenGuard("(Get-Process chrome).CloseMainWindow()"),/명령\(run\)으로 하지 않습니다/);
});

test('web files and addresses are not opened with the default browser, and Edge is not launched',()=>{
  assert.match(runScreenGuard("Start-Process 'C:/work/index.html'"),/open_file/);
  assert.match(runScreenGuard('start "" http://localhost:3000'),/open_file/);
  assert.match(runScreenGuard("& 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' index.html"),/엣지는 쓰지 않습니다/);
  // 사용자가 엣지를 요청했을 때만 엣지 실행을 허용합니다.
  assert.equal(runScreenGuard('msedge.exe --version',true),'');
});

test('ordinary coding commands still run',()=>{
  for(const command of ['npm install','npm run dev','node server.js','git status','python -m http.server 8000','Get-ChildItem *.html',
    "& 'C:/Program Files/Google/Chrome/Application/chrome.exe' --headless --dump-dom 'C:/work/index.html'",'Start-Process notepad','npx serve .'])
    assert.equal(runScreenGuard(command),'',command);
});
