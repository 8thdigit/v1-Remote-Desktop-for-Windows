# Schedules a one-shot Task Scheduler task that silently runs the
# Msfwr uninstaller after the chosen number of hours (default 24).
# Called by installer.nsi via nsExec; exit code 0 means the task is armed.
#
# This uses the ScheduledTasks cmdlets rather than schtasks.exe. schtasks
# reads /sd in the PC's regional date format (for example dd/MM/yyyy), so a
# fixed yyyy/MM/dd date failed on most non-US PCs, and its /tr quoting broke
# under Windows PowerShell 5.1. The cmdlets take a DateTime and a separate
# executable and argument, so neither problem can happen.
param(
    [Parameter(Mandatory = $true)][int]$Hours,
    [Parameter(Mandatory = $true)][string]$Uninstaller
)

$ErrorActionPreference = 'Stop'
$log = Join-Path $env:TEMP 'msfwr-schedule-uninstall.log'

try {
    if ($Hours -lt 1 -or $Hours -gt 720) { exit 2 }
    if (-not (Test-Path -LiteralPath $Uninstaller)) { exit 3 }

    $when = (Get-Date).AddHours($Hours)

    # /S is the NSIS switch for a silent uninstall.
    $action = New-ScheduledTaskAction -Execute $Uninstaller -Argument '/S'
    $trigger = New-ScheduledTaskTrigger -Once -At $when
    # Run as soon as possible if the PC was off or asleep at the set time,
    # and do not skip or stop the run on battery power.
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable `
        -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

    Register-ScheduledTask -TaskName 'msfwr-auto-uninstall' -Action $action `
        -Trigger $trigger -Settings $settings -Force | Out-Null
    exit 0
}
catch {
    # Keep the reason somewhere a support person can find it.
    try { "$(Get-Date -Format o) $_" | Out-File -FilePath $log -Append -Encoding utf8 } catch { }
    Write-Output $_
    exit 1
}
