param([ValidateSet('open','capture')][string]$Action,[string]$Argument)
function Start-ObservedProcess {
    param([Parameter(Position=0)][string]$FilePath,[Parameter(Position=1)][string[]]$ArgumentList)
    [Console]::Error.WriteLine('@launch active')
    try { Microsoft.PowerShell.Management\Start-Process @PSBoundParameters } finally { [Console]::Error.WriteLine('@launch idle') }
}

$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
if ($Action -eq 'capture'){
    Add-Type -AssemblyName System.Windows.Forms,System.Drawing
    Add-Type 'using System.Runtime.InteropServices; public class CaptureDpi { [DllImport("user32.dll")] public static extern bool SetProcessDPIAware(); }'
    [void][CaptureDpi]::SetProcessDPIAware()
    $rect=[Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bmp=[Drawing.Bitmap]::new($rect.Width,$rect.Height)
    try {
        $graphics=[Drawing.Graphics]::FromImage($bmp)
        try {$graphics.CopyFromScreen($rect.Location,[Drawing.Point]::Empty,$rect.Size)} finally {$graphics.Dispose()}
        $stream=[IO.File]::Open($Argument,'CreateNew','Write','None')
        try {$bmp.Save($stream,[Drawing.Imaging.ImageFormat]::Png)} finally {$stream.Dispose()}
        "$($bmp.Width)×$($bmp.Height)"
    }finally{$bmp.Dispose()}
    return
}
if($Argument -in '크롬','Chrome','Google Chrome','구글 크롬'){
    Add-Type -AssemblyName UIAutomationClient
    $root=[Windows.Automation.AutomationElement]::RootElement
    $cond=[Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ClassNameProperty,'Chrome_WidgetWin_1')
    $before=@($root.FindAll([Windows.Automation.TreeScope]::Children,$cond) | ForEach-Object {$_.Current.NativeWindowHandle})
    $paths=@("$env:ProgramFiles\Google\Chrome\Application\chrome.exe","$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",(Join-Path ([Environment]::GetFolderPath('ProgramFilesX86')) 'Google\Chrome\Application\chrome.exe'))
    $chrome=$paths | Where-Object {Test-Path -LiteralPath $_} | Select-Object -First 1
    if(!$chrome){throw 'Chrome 실행 파일을 찾지 못했습니다.'}
    Start-ObservedProcess -FilePath $chrome -ArgumentList '--new-window','chrome://newtab/'
    for($i=0;$i -lt 50;$i++){
        $new=$root.FindAll([Windows.Automation.TreeScope]::Children,$cond) | Where-Object {
            $_.Current.NativeWindowHandle -notin $before -and
              (Get-Process -Id $_.Current.ProcessId -ErrorAction SilentlyContinue).ProcessName -eq 'chrome'
        } | Select-Object -First 1
        if($new){return 'Chrome 새 창을 열고 확인했습니다.'}
        Start-Sleep -Milliseconds 150
    }
    throw 'Chrome의 새 창을 확인하지 못했습니다.'
}
$catalog=@(Get-StartApps)
$builtin=@{'메모장'='notepad';'notepad'='notepad';'계산기'='calc';'calculator'='calc';'문자표'='charmap';'그림판'='mspaint'}
$aliasFile=Join-Path $PSScriptRoot '앱별칭.json'
$aliases=@{}
if(Test-Path -LiteralPath $aliasFile){
    try{(Get-Content -LiteralPath $aliasFile -Raw -Encoding UTF8 | ConvertFrom-Json).PSObject.Properties | ForEach-Object {$aliases[$_.Name]=[string]$_.Value}}catch{}
}
# 이름 정규화: 공백·기호 제거, 소문자, 흔한 한글 별명을 영어로 바꿉니다. 예) 'vs코드' → 'visualstudiocode'
function Normalize([string]$s){
    $t=($s -replace '[\s\-_.·()]','').ToLowerInvariant()
    foreach($pair in @(@('코드','code'),@('크롬','chrome'),@('엣지','edge'),@('엑셀','excel'),@('워드','word'),@('파워포인트','powerpoint'),@('카톡','카카오톡'),@('디코','discord'),@('디스코드','discord'),@('스팀','steam'))){$t=$t.Replace($pair[0],$pair[1])}
    if($t -match '^vs(?!.*visualstudio)'){$t='visualstudio'+$t.Substring(2)}
    $t
}
function Find-App([string]$name){
    $exact=@($catalog | Where-Object {$_.Name -eq $name})
    if($exact.Count -eq 1){return $exact}
    $key=Normalize $name
    if($key.Length -lt 2){return @()}
    $norm=@($catalog | Where-Object {(Normalize $_.Name) -eq $key})
    if($norm.Count -eq 1){return $norm}
    $prefix=@($catalog | Where-Object {(Normalize $_.Name).StartsWith($key)})
    if($prefix.Count -eq 1){return $prefix}
    if($key.Length -ge 3){
        $part=@($catalog | Where-Object {(Normalize $_.Name).Contains($key)})
        if($part.Count -eq 1){return $part}
    }
    return @()
}
Add-Type -AssemblyName UIAutomationClient
function Get-TopWindows{
    [Windows.Automation.AutomationElement]::RootElement.FindAll([Windows.Automation.TreeScope]::Children,[Windows.Automation.Condition]::TrueCondition) |
        Where-Object {$_.Current.ProcessId -ne $PID -and $_.Current.Name -and $_.Current.Name -ne '로컬 Gemma'}
}
$before=@(Get-TopWindows | ForEach-Object {$_.Current.NativeWindowHandle})
$learned=$false
if($builtin.ContainsKey($Argument)){
    Start-ObservedProcess ($builtin[$Argument]+'.exe')
}else{
    $entry=@()
    if($aliases.ContainsKey($Argument)){$entry=@($catalog | Where-Object {$_.Name -ceq $aliases[$Argument]})}
    if($entry.Count -ne 1){$entry=@(Find-App $Argument)}
    if($entry.Count -ne 1){
        $names=@($catalog | ForEach-Object {$_.Name} | Sort-Object -Unique)
        $model=if($env:LOCAL_AGENT_MODEL){$env:LOCAL_AGENT_MODEL}else{'gemma3:12b'}
        $schema=@{type='object';properties=@{name=@{type='string';enum=@('')+$names}};required=@('name')}
        $examples='Examples: "vs코드" -> "Visual Studio Code", "카톡" -> "카카오톡", "엑셀" -> "Excel".'
        $ctx=if($env:LOCAL_AGENT_CTX -match '^\d+$'){[int]$env:LOCAL_AGENT_CTX}else{32768}
        $request=@{model=$model;stream=$false;format=$schema;keep_alive='5m';options=@{temperature=0;num_ctx=$ctx};messages=@(
            @{role='system';content=('Resolve the requested nickname to one installed app. Return its exact name, or empty if ambiguous or absent. '+$examples)},
            @{role='user';content=(@{request=$Argument;installed=$names} | ConvertTo-Json -Compress)}
        )} | ConvertTo-Json -Depth 8 -Compress
        $reply=Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/chat' -Method Post -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($request)) -TimeoutSec 90
        $resolved=($reply.message.content | ConvertFrom-Json).name
        $entry=@($catalog | Where-Object {$_.Name -ceq $resolved})
        if(!$resolved -or $entry.Count -ne 1){
            $key=Normalize $Argument
            $hint=@($catalog | Where-Object {$k=Normalize $_.Name; $key.Length -ge 2 -and ($k.Contains($key.Substring(0,[Math]::Min(3,$key.Length))))} | Select-Object -First 3 -ExpandProperty Name)
            throw ('설치 목록에서 "'+$Argument+'" 앱을 하나로 특정하지 못했습니다.'+$(if($hint){' 비슷한 앱: '+($hint -join ', ')}else{''}))
        }
        $learned=$true
    }
    $original=$Argument
    $Argument=$entry[0].Name
}
$targetExe=$null
if(!$builtin.ContainsKey($Argument)){
    # 시작 메뉴 바로가기가 실행 파일을 가리키면 그 파일로 실행해 프로세스로 확인합니다.
    $folders=@([Environment]::GetFolderPath('Programs'),[Environment]::GetFolderPath('CommonPrograms'))
    $shell=New-Object -ComObject WScript.Shell
    $targets=@(Get-ChildItem -LiteralPath $folders -Filter '*.lnk' -Recurse -ErrorAction SilentlyContinue |
        Where-Object BaseName -eq $Argument | ForEach-Object {$shell.CreateShortcut($_.FullName).TargetPath} |
        Where-Object {$_ -and $_.EndsWith('.exe') -and (Test-Path -LiteralPath $_)} | Sort-Object -Unique)
    if($targets.Count -eq 1){$targetExe=$targets[0]; Start-ObservedProcess -FilePath $targetExe}
    else{Start-ObservedProcess explorer.exe -ArgumentList ('shell:AppsFolder\'+$entry[0].AppID)}
}
$patterns=@{notepad='메모장|Notepad';'메모장'='메모장|Notepad';'calculator'='계산기|Calculator';'계산기'='계산기|Calculator';'calc'='계산기|Calculator';'그림판'='그림판|Paint';'mspaint'='그림판|Paint';'문자표'='문자표|Character Map';'charmap'='문자표|Character Map'}
$pattern=if($patterns.ContainsKey($Argument)){$patterns[$Argument]}else{[Regex]::Escape($Argument)}
for($i=0;$i -lt 40;$i++){
    # 실행 전에 없던 창만 성공으로 인정합니다.
    $found=Get-TopWindows | Where-Object {$_.Current.NativeWindowHandle -notin $before -and ($_.Current.Name -match $pattern -or ($targetExe -and (Get-Process -Id $_.Current.ProcessId -ErrorAction SilentlyContinue).Path -eq $targetExe))} | Select-Object -First 1
    if($found){
        if($learned){
            # 모델이 고른 이름이 실제로 창까지 확인되면 다음부터 바로 쓰도록 기억합니다.
            $aliases[$original]=$Argument
            $tmp=$aliasFile+'.'+[Guid]::NewGuid()
            [IO.File]::WriteAllText($tmp,($aliases | ConvertTo-Json -Compress),[Text.UTF8Encoding]::new($false))
            Move-Item -LiteralPath $tmp -Destination $aliasFile -Force
        }
        return ('새 창 확인: '+$found.Current.Name)
    }
    Start-Sleep -Milliseconds 250
}
$existing=Get-TopWindows | Where-Object {$_.Current.Name -match $pattern -or ($targetExe -and (Get-Process -Id $_.Current.ProcessId -ErrorAction SilentlyContinue).Path -eq $targetExe)} | Select-Object -First 1
if($existing){return ('새 창은 뜨지 않았고, 이미 열려 있던 창이 있습니다: '+$existing.Current.Name)}
throw '실행 요청 후 앱 창을 확인하지 못했습니다.'
