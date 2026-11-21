Add-Type -AssemblyName System.Windows.Forms,System.Drawing
$root=Join-Path $env:LOCALAPPDATA 'LocalGemmaDesktop\training'
$python=Join-Path $root 'env\Scripts\python.exe'
$worker=Join-Path $PSScriptRoot 'auto_feedback.py'
$form=New-Object Windows.Forms.Form
$form.Text='로컬 학습 결과'
$form.ClientSize=New-Object Drawing.Size(540,340)
$list=New-Object Windows.Forms.ListBox
$list.SetBounds(15,45,510,220)
$form.Controls.Add($list)
$title=New-Object Windows.Forms.Label
$title.SetBounds(15,15,520,25)
$title.Text='새 좋아요 4건마다 0.5B와 35B를 순서대로 학습합니다.'
$form.Controls.Add($title)
$folders=@(foreach($group in 'runs','smoke'){Get-ChildItem (Join-Path $root $group) -Directory -ErrorAction SilentlyContinue|Sort-Object Name -Descending|Where-Object {Test-Path (Join-Path $_.FullName 'result.json')}})
foreach($folder in $folders){$type=if($folder.Parent.Name -eq 'smoke'){'설치 검증'}else{'사용자 평가'};[void]$list.Items.Add("$type   $((Get-Content -Raw -Encoding UTF8 (Join-Path $folder.FullName 'result.json')|ConvertFrom-Json).base)   $($folder.Name)")}
if($list.Items.Count){$list.SelectedIndex=0}
$view=New-Object Windows.Forms.Button
$view.SetBounds(15,280,200,38)
$view.Text='훈련 전후 답변 보기'
$view.Add_Click({if($list.SelectedIndex -ge 0){Start-Process (Join-Path $folders[$list.SelectedIndex].FullName '비교.html')}})
$form.Controls.Add($view)
$apply=New-Object Windows.Forms.Button
$apply.SetBounds(230,280,295,38)
$apply.Text='선택한 버전을 Ollama에 등록'
$apply.Add_Click({if($list.SelectedIndex -ge 0){$form.UseWaitCursor=$true;$apply.Enabled=$false;try{& $python $worker apply $folders[$list.SelectedIndex].FullName;if($LASTEXITCODE){throw '등록 실패'};[Windows.Forms.MessageBox]::Show('등록된 모델: feedback-qwen:'+$folders[$list.SelectedIndex].Name)}catch{[Windows.Forms.MessageBox]::Show($_.Exception.Message)}finally{$apply.Enabled=$true;$form.UseWaitCursor=$false}}})
$form.Controls.Add($apply)
[void]$form.ShowDialog()
