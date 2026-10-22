param([int]$RootPid)
# Total processor seconds (user + kernel) of a process and all its descendants. Prints one number.
$all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId
$ids = New-Object System.Collections.Generic.HashSet[int]
$null = $ids.Add($RootPid)
$changed = $true
while ($changed) {
  $changed = $false
  foreach ($p in $all) { if ($ids.Contains([int]$p.ParentProcessId) -and -not $ids.Contains([int]$p.ProcessId)) { $null = $ids.Add([int]$p.ProcessId); $changed = $true } }
}
$sum = 0.0
foreach ($id in $ids) { try { $sum += (Get-Process -Id $id -ErrorAction Stop).TotalProcessorTime.TotalSeconds } catch { } }
[math]::Round($sum, 3)
