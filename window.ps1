param([int]$ProcessId,[string]$Action,[string]$Selector,[string]$Value)
$ErrorActionPreference='Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName UIAutomationClient,UIAutomationTypes
$window = (Get-Process -Id $ProcessId).MainWindowHandle
if ($window -ne [IntPtr]::Zero) {
    $root = [Windows.Automation.AutomationElement]::FromHandle($window)
} else {
    $condition = [Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ProcessIdProperty,$ProcessId)
    $root = [Windows.Automation.AutomationElement]::RootElement.FindFirst([Windows.Automation.TreeScope]::Children,$condition)
    if (!$root) {
        $frames=[Windows.Automation.AutomationElement]::RootElement.FindAll([Windows.Automation.TreeScope]::Children,[Windows.Automation.PropertyCondition]::new([Windows.Automation.AutomationElement]::ClassNameProperty,'ApplicationFrameWindow'))
        foreach ($frame in $frames) {
            $root=$frame.FindFirst([Windows.Automation.TreeScope]::Descendants,$condition)
            if ($root) {break}
        }
        if (!$root) { throw 'No accessible window for selected process' }
    }
}
$elements = $root.FindAll([Windows.Automation.TreeScope]::Descendants,[Windows.Automation.Condition]::TrueCondition)
$matches = @()
$description = foreach ($element in $elements) {
    if ($element.Current.ProcessId -ne $ProcessId) { continue }
    $id = $element.Current.AutomationId
    $name = $element.Current.Name
    if ($Selector -and ($Selector -ceq $id -or $Selector -ceq $name)) { $matches += $element }
    if ($Action -eq 'inspect') {
        $item = @{id=$id; name=$name; type=$element.Current.ControlType.ProgrammaticName; actions=@()}
        $pattern=$null
        if (!$element.Current.IsPassword -and $element.TryGetCurrentPattern([Windows.Automation.ValuePattern]::Pattern,[ref]$pattern)) {
            $item.value=$pattern.Current.Value
            if (!$pattern.Current.IsReadOnly) {$item.actions+='set_value'}
        }
        if ($element.TryGetCurrentPattern([Windows.Automation.TogglePattern]::Pattern,[ref]$pattern)) {
            $item.state=$pattern.Current.ToggleState.ToString()
            $item.actions+='toggle'
        }
        if ($element.TryGetCurrentPattern([Windows.Automation.InvokePattern]::Pattern,[ref]$pattern)) {$item.actions+='invoke'}
        if (!$element.Current.IsEnabled -or $element.Current.IsPassword) {$item.actions=@()}
        $item
    }
}
if ($Action -eq 'inspect') { ConvertTo-Json -InputObject @($description) -Compress; exit }
if ($matches.Count -ne 1) { throw 'Select one unique control by its exact name or automation id' }
$selected = $matches[0]
if ($selected.Current.IsPassword) { throw 'Password field' }
switch ($Action) {
    'set_value' {
        $selected.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern).SetValue($Value)
        $readback=$selected.GetCurrentPattern([Windows.Automation.ValuePattern]::Pattern).Current.Value
        if ($readback -cne $Value -and $readback -cne ($Value+[char]13)) { throw 'Value did not match after input' }
        'Value verified'
    }
    'invoke' { $selected.GetCurrentPattern([Windows.Automation.InvokePattern]::Pattern).Invoke(); 'Invoked' }
    'toggle' { $selected.GetCurrentPattern([Windows.Automation.TogglePattern]::Pattern).Toggle(); 'Toggled' }
    default { throw 'Unsupported window action' }
}
