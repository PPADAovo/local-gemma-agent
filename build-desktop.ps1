param([string]$OutputName='로컬 Gemma.exe')
$ErrorActionPreference='Stop'
$lib=Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
Push-Location $PSScriptRoot
try {
    $mainOutput=if([IO.Path]::IsPathRooted($OutputName)){$OutputName}else{Join-Path $PSScriptRoot $OutputName}
    $buildDir=[IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($mainOutput))
    [void][IO.Directory]::CreateDirectory($buildDir)
    $imageOutput=Join-Path $buildDir 'GemmaImageViewer.exe'
    $icon=@(); if (Test-Path -LiteralPath '로컬Gemma.ico') { $icon=@('/win32icon:로컬Gemma.ico') }  # 앱 아이콘
    & "$lib\csc.exe" /nologo /codepage:65001 /target:winexe /win32manifest:Desktop.manifest "/out:$mainOutput" @icon /res:Desktop.xaml,Desktop.xaml "/r:$lib\WPF\PresentationFramework.dll" "/r:$lib\WPF\PresentationCore.dll" "/r:$lib\WPF\WindowsBase.dll" "/r:$lib\System.Xaml.dll" "/r:$lib\System.Web.Extensions.dll" "/r:$lib\WPF\UIAutomationClient.dll" "/r:$lib\WPF\UIAutomationTypes.dll" /r:System.Windows.Forms.dll /r:System.Xml.Linq.dll /r:Microsoft.Web.WebView2.Core.dll /r:Microsoft.Web.WebView2.Wpf.dll /r:Markdig.dll /r:WpfMath.dll "/r:$lib\WPF\WindowsFormsIntegration.dll" /r:System.Drawing.dll "/r:$env:windir/Microsoft.NET/assembly/GAC_MSIL/System.Speech/v4.0_4.0.0.0__31bf3856ad364e35/System.Speech.dll" DesktopIntegrity.cs DesktopDialogs.cs DesktopAnswerActions.cs DesktopPluginHome.cs DesktopSkillDetails.cs DesktopProjectList.cs DesktopBrowserPane.cs DesktopVoicePanel.cs ChromePanel.cs DesktopChatPhotos.cs DesktopRailPages.cs DesktopProfileActivity.cs DesktopMarkdown.cs DesktopFind.cs DesktopTurnRail.cs Desktop.cs DesktopMenus.cs DesktopMotion.cs DesktopPreferences.cs DesktopModels.cs DesktopFiles.cs DesktopQueue.cs DesktopHotkey.cs DesktopAttach.cs DesktopAsk.cs DesktopEditors.cs DesktopSlash.cs
    if ($LASTEXITCODE) {throw '데스크톱 앱 빌드 실패'}

    & "$lib\csc.exe" /nologo /codepage:65001 /target:winexe "/out:$imageOutput" "/r:$lib\WPF\PresentationFramework.dll" "/r:$lib\WPF\PresentationCore.dll" "/r:$lib\WPF\WindowsBase.dll" "/r:$lib\System.Xaml.dll" "/r:$lib\System.Web.Extensions.dll" ImageViewer.cs
    if ($LASTEXITCODE) {throw '이미지 뷰어 빌드 실패'}
} finally {Pop-Location}





