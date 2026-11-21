param([Parameter(Mandatory)][ValidateSet('playpause','next','prev','volup','voldown','mute','search')][string]$Action,[string]$Query)
$ErrorActionPreference='Stop'
Add-Type -Name K -Namespace M -MemberDefinition '[DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, System.UIntPtr extra);'
function Press([byte]$vk,[int]$n=1){ for($i=0;$i -lt $n;$i++){ [M.K]::keybd_event($vk,0,0,[UIntPtr]::Zero); [M.K]::keybd_event($vk,0,2,[UIntPtr]::Zero); Start-Sleep -Milliseconds 40 } }
switch($Action){
 'playpause' {Press 0xB3; '재생/일시정지'}
 'next'      {Press 0xB0; '다음 곡'}
 'prev'      {Press 0xB1; '이전 곡'}
 'volup'     {Press 0xAF 5; '볼륨 올림'}
 'voldown'   {Press 0xAE 5; '볼륨 내림'}
 'mute'      {Press 0xAD; '음소거 전환'}
 'search'    { if(!$Query){throw '검색어가 필요합니다.'}; Start-Process ('spotify:search:'+[Uri]::EscapeDataString($Query)); 'Spotify 검색 열기: '+$Query }
}
