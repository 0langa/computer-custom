<# Opt-in, elevated: exercise real install/upgrade/rollback/uninstall in an isolated protected directory. #>
[CmdletBinding()]
param([string] $EvidencePath = (Join-Path $PSScriptRoot '../.cache/evidence/install-lifecycle.json'))
$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not ([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this lifecycle test from an elevated PowerShell.'
}
$testId = [Guid]::NewGuid().ToString('N')
$testInstall = Join-Path $env:ProgramFiles ('Computer Custom Acceptance-' + $testId)
$testCert = 'CN=Computer Custom Acceptance ' + $testId
$testTask = 'ComputerCustom.Acceptance.' + $testId
$testData = Join-Path ([IO.Path]::GetTempPath()) ('computer-custom-lifecycle-' + $testId)
$priorLocalAppData = $env:LOCALAPPDATA
$installer = Join-Path $PSScriptRoot 'install-elevated-helper.ps1'
. (Join-Path $PSScriptRoot 'activate-helper-install.ps1')
New-Item -ItemType Directory -Path $testData -Force | Out-Null
$evidence = [ordered]@{ timestamp = [DateTimeOffset]::UtcNow.ToString('o'); installed = $false; upgraded = $false; rollback = $false; uninstalled = $false; certificateRemoved = $false }
try {
    # Isolate legacy session cleanup as well as current per-run token files.
    $env:LOCALAPPDATA = $testData
    & $installer -InstallDir $testInstall -CertSubject $testCert -TaskName $testTask
    $first = Get-Content -LiteralPath (Join-Path $testInstall 'active.json') -Raw
    $evidence.installed = $true
    & $installer -InstallDir $testInstall -CertSubject $testCert -TaskName $testTask
    $second = Get-Content -LiteralPath (Join-Path $testInstall 'active.json') -Raw
    if ($first -eq $second) { throw 'Upgrade did not activate a new immutable version' }
    $oldVersion = Join-Path $testInstall (($first | ConvertFrom-Json).directory)
    if (-not (Test-Path -LiteralPath (Join-Path $oldVersion 'computer-custom-helper.dll'))) { throw 'Upgrade removed the previous version' }
    $evidence.upgraded = $true
    $stage = Join-Path $testData 'corrupt-stage'
    $activeVersion = Join-Path $testInstall (($second | ConvertFrom-Json).directory)
    Copy-Item -LiteralPath $activeVersion -Destination $stage -Recurse
    [IO.File]::WriteAllText((Join-Path $stage 'computer-custom-helper.dll'),'intentional isolated corruption')
    try { Install-HelperVersion -Staging $stage -InstallDir $testInstall; throw 'Corrupt candidate unexpectedly activated' }
    catch { if ($_.Exception.Message -notlike '*hash mismatch*') { throw } }
    if ((Get-Content -LiteralPath (Join-Path $testInstall 'active.json') -Raw) -ne $second) { throw 'Rollback changed the active pointer' }
    $evidence.rollback = $true
    & $installer -Uninstall -InstallDir $testInstall -CertSubject $testCert -TaskName $testTask
    if (Test-Path -LiteralPath $testInstall) { throw 'Uninstall left the isolated installation behind' }
    $evidence.uninstalled = $true
    $remaining = @(foreach ($store in @('My','Root','TrustedPublisher')) {
        Get-ChildItem ('Cert:/LocalMachine/' + $store) | Where-Object { $_.Subject -eq $testCert }
    })
    if ($remaining.Count) { throw 'Uninstall left the isolated certificate behind' }
    $evidence.certificateRemoved = $true
} finally {
    $env:LOCALAPPDATA = $priorLocalAppData
    New-Item -ItemType Directory -Path (Split-Path -Parent $EvidencePath) -Force | Out-Null
    $evidence | ConvertTo-Json | Set-Content -LiteralPath $EvidencePath
    if (-not $evidence.uninstalled -and (Test-Path -LiteralPath $testInstall)) {
        Write-Warning "Isolated lifecycle installation retained for diagnosis: $testInstall ($testCert)"
    }
    $resolvedTestData = [IO.Path]::GetFullPath($testData)
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if ($resolvedTestData.StartsWith($tempRoot,[StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $resolvedTestData)) {
        Remove-Item -LiteralPath $resolvedTestData -Recurse -Force
    }
}
$evidence | ConvertTo-Json
