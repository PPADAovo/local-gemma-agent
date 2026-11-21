$ErrorActionPreference='Stop'
Add-Type -AssemblyName PresentationFramework
[xml]$layout=@"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" Title="Gemma 작업 확인" WindowStartupLocation="CenterScreen" SizeToContent="Height" Width="580" ResizeMode="NoResize" WindowStyle="None" AllowsTransparency="True" Background="Transparent" Topmost="True" FontFamily="Malgun Gothic">
<Border Padding="22" Background="White" BorderBrush="#D4D4D4" BorderThickness="1" CornerRadius="16"><StackPanel>
<TextBlock Text="로컬 Gemma · 작업 확인" Foreground="#676A70"/>
<TextBlock Name="TitleLine" Margin="0,12,0,8" FontSize="17" FontWeight="SemiBold" TextWrapping="Wrap"/>
<TextBlock Name="Preview" TextWrapping="NoWrap" TextTrimming="CharacterEllipsis" Foreground="#50545B" FontFamily="Consolas, Malgun Gothic"/>
<Expander Name="Details" Header="실행 내용 펼치기" Margin="0,10,0,14"><TextBox Name="Full" Margin="0,8,0,0" Padding="8" MaxHeight="210" IsReadOnly="True" TextWrapping="Wrap" VerticalScrollBarVisibility="Auto" Background="#F6F7F8" BorderThickness="0"/></Expander>
<StackPanel Orientation="Horizontal" HorizontalAlignment="Right">
<Button Name="Deny" Content="거부  (Esc)" IsCancel="True" Padding="14,7" Background="White" BorderBrush="#D6D6D6"/>
<Button Name="Allow" Content="이번 한 번 허용" Margin="8,0,0,0" Padding="14,7" Background="#202124" Foreground="White" BorderThickness="0"/>
</StackPanel></StackPanel></Border></Window>
"@
$window=[Windows.Markup.XamlReader]::Load([Xml.XmlNodeReader]::new($layout))
$message=$env:GEMMA_CONFIRM_DETAIL
$window.FindName('TitleLine').Text=$env:GEMMA_CONFIRM_TITLE
$window.FindName('Full').Text=$message
$window.FindName('Preview').Text=($message -replace '\s+',' ').Trim()
$window.FindName('Allow').Add_Click({$window.DialogResult=$true})
if($window.ShowDialog() -eq $true){'Yes'}else{'No'}
