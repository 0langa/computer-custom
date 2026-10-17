<#
.SYNOPSIS
    Shows, and optionally changes, whether Windows draws UAC elevation prompts
    on the secure desktop.

.DESCRIPTION
    By default Windows shows a UAC consent prompt on the SECURE DESKTOP: a
    separate desktop object that only Windows processes can reach. That is why
    no automation can click a UAC prompt, at any privilege, signed or not.

    Turning the secure desktop off moves those prompts onto the ordinary
    desktop, where a high-integrity process can click them.

    READ THIS BEFORE USING -Disable
    This does not grant the capability to Computer Custom. It grants it to
    EVERYTHING running on the machine. The secure desktop exists precisely so
    that software cannot answer its own elevation prompts. With it off, any
    program running as you can watch for a UAC prompt and approve it, and the
    one thing standing between "this code runs as me" and "this code runs as
    administrator" is gone.

    That is the entire trade. It is a real reduction in the machine's security,
    not a formality, and it is why this is a separate script you run yourself
    rather than anything the plugin can do.

    Use it for a specific task, then turn it back on. -Minutes does that for
    you, so a forgotten setting cannot leave the machine exposed.

    This script changes exactly one value: PromptOnSecureDesktop. It does not
    touch UAC's prompt behaviour, does not disable UAC, and does not change how
    often you are asked.

.PARAMETER Status
    Show the current setting. This is the default, and needs no admin rights.

.PARAMETER Disable
    Move elevation prompts onto the ordinary desktop. Requires -IUnderstand.

.PARAMETER Enable
    Put elevation prompts back on the secure desktop, and cancel any pending
    automatic restore.

.PARAMETER Minutes
    With -Disable, automatically restore the secure desktop after this many
    minutes. Strongly recommended.

.PARAMETER IUnderstand
    Required for -Disable. Confirms you have read what it costs.

.EXAMPLE
    # Just look:
    .\uac-secure-desktop.ps1

.EXAMPLE
    # Turn it off for one 20 minute job, restoring itself afterwards:
    .\uac-secure-desktop.ps1 -Disable -Minutes 20 -IUnderstand

.EXAMPLE
    # Put it back right now:
    .\uac-secure-desktop.ps1 -Enable
#>

[CmdletBinding(DefaultParameterSetName = 'Status')]
param(
    [Parameter(ParameterSetName = 'Status')] [switch] $Status,
    [Parameter(ParameterSetName = 'Disable', Mandatory)] [switch] $Disable,
    [Parameter(ParameterSetName = 'Enable', Mandatory)] [switch] $Enable,
    [Parameter(ParameterSetName = 'Disable')] [int] $Minutes = 0,
    [Parameter(ParameterSetName = 'Disable')] [switch] $IUnderstand,
    [switch] $DryRun
)

$ErrorActionPreference = 'Stop'

$PolicyPath = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System'
$ValueName = 'PromptOnSecureDesktop'
$RestoreTask = 'ComputerCustom.RestoreSecureDesktop'

$scriptRoot = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Definition }
$scriptPath = Join-Path $scriptRoot 'uac-secure-desktop.ps1'

function Test-Admin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    return ([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole(
        [Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-Current {
    $value = (Get-ItemProperty -Path $PolicyPath -Name $ValueName -ErrorAction SilentlyContinue).$ValueName
    # A missing value means the Windows default, which is on.
    if ($null -eq $value) { return $true }
    return [int]$value -ne 0
}

function Get-PendingRestore {
    $task = Get-ScheduledTask -TaskName $RestoreTask -ErrorAction SilentlyContinue
    if (-not $task) { return $null }
    return (Get-ScheduledTaskInfo -TaskName $RestoreTask -ErrorAction SilentlyContinue).NextRunTime
}

function Show-Status {
    $on = Get-Current
    Write-Host ''
    Write-Host 'UAC secure desktop' -ForegroundColor Cyan
    if ($on) {
        Write-Host '  ON  (Windows default)' -ForegroundColor Green
        Write-Host '  Elevation prompts are drawn where no software can reach them.'
        Write-Host '  Nothing can automate a UAC prompt. You answer them yourself.'
    }
    else {
        Write-Host '  OFF' -ForegroundColor Yellow
        Write-Host '  Elevation prompts appear on the ordinary desktop.'
        Write-Host '  Any software running as you can approve them, not just this plugin.'
    }

    $pending = Get-PendingRestore
    if ($pending) {
        Write-Host "  Automatic restore scheduled for $pending" -ForegroundColor Cyan
    }
    elseif (-not $on) {
        Write-Host '  No automatic restore is scheduled. It stays off until you turn it back on.' -ForegroundColor Yellow
    }
    Write-Host ''
}

function Set-SecureDesktop([bool] $On) {
    if ($DryRun) {
        Write-Host "  DRY RUN: would set $ValueName = $([int]$On)"
        return
    }

    if (-not (Test-Path $PolicyPath)) { New-Item -Path $PolicyPath -Force | Out-Null }
    Set-ItemProperty -Path $PolicyPath -Name $ValueName -Value ([int]$On) -Type DWord
}

function Remove-RestoreTask {
    if (Get-ScheduledTask -TaskName $RestoreTask -ErrorAction SilentlyContinue) {
        if ($DryRun) {
            Write-Host "  DRY RUN: would cancel the pending restore task"
            return
        }
        Unregister-ScheduledTask -TaskName $RestoreTask -Confirm:$false
    }
}

# ------------------------------------------------------------------- status

if ($PSCmdlet.ParameterSetName -eq 'Status') {
    Show-Status
    Write-Host 'To change it:'
    Write-Host "  $scriptPath -Disable -Minutes 20 -IUnderstand    # off, restores itself"
    Write-Host "  $scriptPath -Enable                              # back on now"
    Write-Host ''
    exit 0
}

if (-not $DryRun -and -not (Test-Admin)) {
    Write-Error @"
Changing this needs administrator rights.

  Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile','-File','$scriptPath','-Enable'
"@
    exit 1
}

# ------------------------------------------------------------------ enable

if ($Enable) {
    Write-Host ''
    Write-Host 'Restoring the secure desktop for elevation prompts' -ForegroundColor Cyan
    Set-SecureDesktop $true
    Remove-RestoreTask
    Show-Status
    exit 0
}

# ----------------------------------------------------------------- disable

if (-not $IUnderstand) {
    Write-Error @"
-Disable requires -IUnderstand.

Turning the secure desktop off does not grant this capability to Computer
Custom. It grants it to EVERY program running as you. The secure desktop is
what stops software from approving its own elevation prompts; without it, the
gap between "runs as me" and "runs as administrator" is a mouse click that any
process can make.

Re-run with -IUnderstand once you have read that, and prefer -Minutes so it
restores itself:

  $scriptPath -Disable -Minutes 20 -IUnderstand
"@
    exit 1
}

Write-Host ''
Write-Host 'Moving elevation prompts onto the ordinary desktop' -ForegroundColor Yellow
Write-Host '  While this is off, any software running as you can approve a UAC prompt.'

Set-SecureDesktop $false
Remove-RestoreTask

if ($Minutes -gt 0) {
    $restoreAt = (Get-Date).AddMinutes($Minutes)
    Write-Host "  Scheduling automatic restore at $restoreAt"

    if (-not $DryRun) {
        # A plain registry write, so CreateProcess is fine here: unlike the
        # uiAccess helper, nothing about this needs ShellExecute.
        $action = New-ScheduledTaskAction -Execute 'powershell.exe' `
            -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$scriptPath`" -Enable"
        $trigger = New-ScheduledTaskTrigger -Once -At $restoreAt
        $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -RunLevel Highest
        $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable

        Register-ScheduledTask -TaskName $RestoreTask -Action $action -Trigger $trigger `
            -Principal $principal -Settings $settings `
            -Description 'Restores the UAC secure desktop after a Computer Custom session.' | Out-Null
    }
}
else {
    Write-Host '  No automatic restore. Turn it back on yourself when the job is done:' -ForegroundColor Yellow
    Write-Host "    $scriptPath -Enable" -ForegroundColor Yellow
}

Show-Status
