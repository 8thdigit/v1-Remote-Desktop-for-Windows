# Schedules a one-shot Task Scheduler task that silently runs the
# Msfwr uninstaller after the chosen number of hours (default 24).
# Called by installer.nsi via nsExec; exit code 0 means the task is armed.
param(
    [Parameter(Mandatory = $true)][int]$Hours,
    [Parameter(Mandatory = $true)][string]$Uninstaller
)

$ErrorActionPreference = 'Stop'

try {
    if ($Hours -lt 1 -or $Hours -gt 720) { exit 2 }
    if (-not (Test-Path -LiteralPath $Uninstaller)) { exit 3 }

    # Compute the run time locally so day/month rollovers are exact.
    $when = (Get-Date).AddHours($Hours)
    $sd = $when.ToString('yyyy/MM/dd')
    $st = $when.ToString('HH:mm')

    # schtasks expects /tr as one argument; embed literal double quotes
    # around the executable path by doubling them for PowerShell parsing.
    $tr = '"""' + $Uninstaller + '" /SILENT""'

    & schtasks.exe /create /f /tn 'msfwr-auto-uninstall' `
        /sc once /sd $sd /st $st /tr $tr | Out-Null

    if ($LASTEXITCODE -ne 0) { exit 4 }
    exit 0
}
catch {
    Write-Output $_ | Out-Null
    exit 1
}
