<#
.SYNOPSIS
    Installs the Computer Custom helper so it can drive elevated application
    windows, or removes that installation again.

.DESCRIPTION
    Three things have to be true before Windows grants an application UIAccess,
    the right to send input to windows running above its own integrity level:

      1. it is signed by a certificate the local machine trusts,
      2. it lives in a protected folder (%ProgramFiles%),
      3. its manifest requests uiAccess.

    This script arranges all three, using a self-signed certificate trusted only
    on this machine. That costs nothing; no certificate authority is involved.

    Administrator rights are needed once, now, to write into Program Files and
    to trust the certificate. After that the plugin starts the helper itself
    through ShellExecute, which is the only launch path that grants UIAccess,
    and no prompt appears.

    WHAT THIS DOES ON ITS OWN
    It covers ordinary elevated windows: installers after they appear, regedit,
    Task Manager. It does NOT by itself make the UAC consent prompt
    automatable, because that prompt is drawn on the secure desktop where
    nothing can reach it.

    Combined with uac-secure-desktop.ps1 -Disable, it does: with the prompt on
    the ordinary desktop, a signed uiAccess helper can click it. That is two
    deliberate steps, and the second one weakens the machine. Read that script
    before using it.

    EVERYTHING HERE IS REVERSIBLE with -Uninstall.

.PARAMETER Uninstall
    Remove the scheduled task, the installed files and the certificate.

.PARAMETER DryRun
    Print every change that would be made, and make none of them.

.EXAMPLE
    # See exactly what would happen, changing nothing:
    .\install-elevated-helper.ps1 -DryRun

.EXAMPLE
    # Install (run from an elevated PowerShell):
    .\install-elevated-helper.ps1

.EXAMPLE
    # Undo everything:
    .\install-elevated-helper.ps1 -Uninstall
#>

[CmdletBinding()]
param(
    [switch] $Uninstall,
    [switch] $DryRun,
    [string] $ProjectPath,
    [string] $InstallDir = (Join-Path $env:ProgramFiles 'Computer Custom'),
    [string] $TaskName = 'ComputerCustom.ElevatedHelper',
    [string] $CertSubject = 'CN=Computer Custom Helper'
)

$ErrorActionPreference = 'Stop'

# $PSScriptRoot is not reliably populated inside a param block's defaults, so
# paths that depend on the script's own location are resolved here instead.
$scriptRoot = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Definition }
if (-not $ProjectPath) {
    $ProjectPath = Join-Path $scriptRoot '..\helper\ComputerCustom.Helper'
}
$scriptPath = Join-Path $scriptRoot 'install-elevated-helper.ps1'

function Write-Step { param([string] $Message) Write-Host "  $Message" }
function Write-Head { param([string] $Message) Write-Host "`n$Message" -ForegroundColor Cyan }
function Write-Note { param([string] $Message) Write-Host "  ! $Message" -ForegroundColor Yellow }

function Test-Admin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-SessionFilePath {
    # The server writes this file, the helper reads and deletes it. It lives in
    # the user's private LocalAppData. Both sides must agree on the path, and
    # the server resolves it at run time from its own environment, so this
    # script must be run by the same account that will use the plugin.
    return Join-Path $env:LOCALAPPDATA 'computer-custom\session.json'
}

# A dry run changes nothing, so it must be inspectable without elevation. You
# should be able to read exactly what a script will do before granting it rights.
if (-not $DryRun -and -not (Test-Admin)) {
    Write-Error @"
This needs administrator rights.

It installs into Program Files, adds a certificate to the machine's trusted
store, and registers a scheduled task. Re-run it from an elevated PowerShell:

  Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile','-File','$scriptPath'
"@
    exit 1
}

if ($DryRun) {
    Write-Note 'DRY RUN. Nothing will be changed.'
    if (-not (Test-Admin)) {
        Write-Note 'Not running as administrator. A real run will need it.'
    }
}

# ---------------------------------------------------------------- uninstall

if ($Uninstall) {
    Write-Head 'Removing the elevated helper'

    # Current installs register no task; this clears one left by an earlier
    # version of the script.
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($task) {
        Write-Step "Unregister obsolete scheduled task: $TaskName"
        if (-not $DryRun) { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false }
    }

    if (Test-Path $InstallDir) {
        Write-Step "Delete: $InstallDir"
        if (-not $DryRun) { Remove-Item -Path $InstallDir -Recurse -Force }
    }
    else {
        Write-Step "Nothing installed at $InstallDir"
    }

    foreach ($store in @('Cert:\LocalMachine\My', 'Cert:\LocalMachine\Root', 'Cert:\LocalMachine\TrustedPublisher')) {
        Get-ChildItem $store -ErrorAction SilentlyContinue |
            Where-Object { $_.Subject -eq $CertSubject } |
            ForEach-Object {
                Write-Step "Remove certificate $($_.Thumbprint) from $store"
                if (-not $DryRun) { Remove-Item -Path $_.PSPath -Force }
            }
    }

    $session = Get-SessionFilePath
    if (Test-Path $session) {
        Write-Step "Delete stale session file: $session"
        if (-not $DryRun) { Remove-Item $session -Force }
    }

    Write-Host "`nDone. The plugin falls back to the normal-privilege helper." -ForegroundColor Green
    exit 0
}

# ------------------------------------------------------------------ install

Write-Head 'Installing the elevated helper'
Write-Step "Account:      $env:USERDOMAIN\$env:USERNAME"
Write-Step "Install to:   $InstallDir"
Write-Step "Certificate:  $CertSubject (self-signed, trusted on this machine only)"

# 1. Build a copy whose manifest requests uiAccess.
$staging = Join-Path ([IO.Path]::GetTempPath()) ("computer-custom-uiaccess-" + [Guid]::NewGuid().ToString('N'))
Write-Head 'Step 1 of 5: build the helper with uiAccess'
Write-Step "dotnet publish -c Release -p:UiAccess=true -> $staging"

if (-not $DryRun) {
    & dotnet publish $ProjectPath -c Release -p:UiAccess=true -o $staging --nologo -v q
    if ($LASTEXITCODE -ne 0) { throw "dotnet publish failed with exit code $LASTEXITCODE" }
}

$exeName = 'computer-custom-helper.exe'
$stagedExe = Join-Path $staging $exeName

# 2. Find or create the signing certificate.
Write-Head 'Step 2 of 5: signing certificate'
$cert = Get-ChildItem Cert:\LocalMachine\My -ErrorAction SilentlyContinue |
    Where-Object { $_.Subject -eq $CertSubject -and $_.HasPrivateKey } |
    Select-Object -First 1

if ($cert) {
    Write-Step "Reusing existing certificate $($cert.Thumbprint)"
}
else {
    Write-Step 'Creating a new self-signed code-signing certificate (valid 5 years)'
    if (-not $DryRun) {
        $cert = New-SelfSignedCertificate `
            -Subject $CertSubject `
            -Type CodeSigningCert `
            -KeyUsage DigitalSignature `
            -KeyAlgorithm RSA `
            -KeyLength 2048 `
            -CertStoreLocation Cert:\LocalMachine\My `
            -NotAfter (Get-Date).AddYears(5)
        Write-Step "Created $($cert.Thumbprint)"
    }
}

# Windows only honours uiAccess when the signature chains to a trusted root on
# this machine. A self-signed certificate has to be placed there deliberately.
Write-Step 'Trust it in LocalMachine\Root and LocalMachine\TrustedPublisher'
if (-not $DryRun) {
    $exported = Join-Path $staging 'helper-cert.cer'
    Export-Certificate -Cert $cert -FilePath $exported | Out-Null
    foreach ($store in @('Root', 'TrustedPublisher')) {
        Import-Certificate -FilePath $exported -CertStoreLocation "Cert:\LocalMachine\$store" | Out-Null
    }
    Remove-Item $exported -Force
}

# 3. Sign.
Write-Head 'Step 3 of 5: sign the executable'
Write-Step "Sign $exeName"
if (-not $DryRun) {
    $signature = Set-AuthenticodeSignature -FilePath $stagedExe -Certificate $cert -HashAlgorithm SHA256
    if ($signature.Status -ne 'Valid') {
        throw "Signing failed: $($signature.Status) - $($signature.StatusMessage)"
    }
    Write-Step "Signature status: $($signature.Status)"
}

# 4. Install into a protected folder.
Write-Head 'Step 4 of 5: install into Program Files'
Write-Step "Copy published files to $InstallDir"
Write-Step 'Record which helper source this was built from'
if (-not $DryRun) {
    if (-not (Test-Path $InstallDir)) { New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null }

    # The server compares this id with the one shipped in the plugin to tell
    # whether the elevated helper is really behind. Timestamps cannot answer
    # that: a reinstall moves them without changing any code.
    # Best effort. Without an id the server simply says nothing, which is the
    # correct behaviour for a question it cannot answer.
    $buildId = $null
    try {
        $buildIdScript = Join-Path $scriptRoot 'helper-build-id.mjs'
        if (Test-Path $buildIdScript) {
            $buildId = (& node $buildIdScript 2>$null | Out-String).Trim()
        }
    }
    catch { $buildId = $null }

    if ($buildId) {
        Set-Content -Path (Join-Path $staging 'build-id.txt') -Value $buildId -NoNewline -Encoding ascii
        Write-Step "Build id $buildId"
    }
    else {
        Write-Step 'Could not compute a build id; the update check will stay quiet'
    }

    Copy-Item -Path (Join-Path $staging '*') -Destination $InstallDir -Recurse -Force
    Remove-Item $staging -Recurse -Force
}

$installedExe = Join-Path $InstallDir $exeName

# 5. Verify the installed copy really will be granted UIAccess.
Write-Head 'Step 5 of 5: verify'
$installedExe = Join-Path $InstallDir $exeName

if (-not $DryRun) {
    $check = Get-AuthenticodeSignature -FilePath $installedExe
    Write-Step "Installed signature: $($check.Status)"
    if ($check.Status -ne 'Valid') {
        Write-Note "Signature is '$($check.Status)'. Windows will start the helper WITHOUT uiAccess."
    }

    # Remove a task left by an earlier version of this script. It never worked:
    # a scheduled task launches via CreateProcess, and CreateProcess cannot
    # start a uiAccess binary (it fails with ERROR_ELEVATION_REQUIRED).
    if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
        Write-Step "Removing obsolete scheduled task: $TaskName"
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
    }

    $sessionDir = Split-Path (Get-SessionFilePath) -Parent
    if (-not (Test-Path $sessionDir)) { New-Item -ItemType Directory -Path $sessionDir -Force | Out-Null }
}
else {
    Write-Step "Check the installed signature is Valid"
}

Write-Host "`nDone." -ForegroundColor Green
Write-Host @"

The plugin will now prefer the elevated helper. To use it, set:

  COMPUTER_CUSTOM_ELEVATED=1

Verify with:

  npm run verify:elevation

Expect power: high and uiAccess: true.

No scheduled task is involved. The helper is launched through ShellExecute,
which is the only way Windows will grant UIAccess - CreateProcess refuses a
uiAccess binary outright. No UAC prompt appears, because granting UIAccess to a
signed binary in a protected folder is precisely what the mechanism is for.

Still out of reach, by Windows design and not by policy:
  the UAC consent prompt. Nothing can automate it. You answer it yourself.

To undo everything:
  $scriptPath -Uninstall
"@
