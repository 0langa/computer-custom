# Copy a complete immutable version, validate it, then atomically activate it.

function Invoke-HelperStartupCheck {
    param([string] $Checker, [string] $Candidate)
    $process = [Diagnostics.Process]::new()
    $process.StartInfo.FileName = (Get-Command node -CommandType Application | Select-Object -First 1).Source
    $process.StartInfo.Arguments = '"' + $Checker + '" "' + $Candidate + '"'
    $process.StartInfo.UseShellExecute = $false
    $process.StartInfo.CreateNoWindow = $true
    $process.StartInfo.RedirectStandardOutput = $true
    $process.StartInfo.RedirectStandardError = $true
    try {
        if (-not $process.Start()) { throw 'Could not start the protected helper checker' }
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit(15000)) {
            $process.Kill()
            $process.WaitForExit()
            throw 'Protected helper checker exceeded its 15-second startup deadline'
        }
        $output = ($stdout.GetAwaiter().GetResult() + $stderr.GetAwaiter().GetResult()).Trim()
        if ($process.ExitCode -ne 0) { throw "Protected helper startup/UIAccess verification failed (exit $($process.ExitCode)): $output" }
        if (-not $output) { throw 'Protected helper checker returned no capability evidence' }
        $capability = $output | ConvertFrom-Json
        if (-not $capability.uiAccess -or -not $capability.preparedInput) { throw "Protected helper returned invalid capabilities: $output" }
        Write-Host $output
    } finally { $process.Dispose() }
}

function Assert-HelperInstallUnused {
    param([string] $InstallDir, [string[]] $ExecutablePaths)
    $root = [IO.Path]::GetFullPath($InstallDir).TrimEnd('\') + '\'
    if (-not $PSBoundParameters.ContainsKey('ExecutablePaths')) {
        $ExecutablePaths = @(Get-Process -Name 'computer-custom-helper','computer-custom-overlay' -ErrorAction SilentlyContinue |
            ForEach-Object { $_.Path })
    }
    foreach ($executable in $ExecutablePaths) {
        if ($executable -and [IO.Path]::GetFullPath($executable).StartsWith($root,[StringComparison]::OrdinalIgnoreCase)) {
            throw 'Computer Custom is still running from this installation. Close its sessions before uninstalling; no files have been removed.'
        }
    }
}

function Install-HelperVersion {
    param([string] $Staging, [string] $InstallDir, [scriptblock] $Verify = {
        param($Directory)
        $signature = Get-AuthenticodeSignature -FilePath (Join-Path $Directory 'computer-custom-helper.exe')
        if ($signature.Status -ne 'Valid') { throw "Installed helper signature is $($signature.Status)" }
    })
    $root = [IO.Path]::GetFullPath($InstallDir).TrimEnd('\')
    $manifest = Get-Content -Raw -LiteralPath (Join-Path $Staging 'provenance.json') | ConvertFrom-Json
    if ($manifest.sourceId -notmatch '^[a-f0-9]{16}$') { throw 'Invalid helper source identity' }
    $relative = 'versions/' + $manifest.sourceId + '-' + [Guid]::NewGuid().ToString('N').Substring(0,8)
    $version = [IO.Path]::GetFullPath((Join-Path $root $relative))
    if (-not $version.StartsWith(($root + '\versions\'),[StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid version destination' }
    $temporary = Join-Path $root ('active-' + [Guid]::NewGuid().ToString('N') + '.tmp')
    $active = Join-Path $root 'active.json'
    try {
        New-Item -ItemType Directory -Path $version -Force | Out-Null
        Copy-Item -Path (Join-Path $Staging '*') -Destination $version -Recurse -Force
        foreach ($required in @('computer-custom-helper.exe','computer-custom-helper.dll')) {
            if (-not $manifest.files.PSObject.Properties[$required]) { throw "No provenance for $required" }
        }
        foreach ($entry in $manifest.files.PSObject.Properties) {
            if ([IO.Path]::GetFileName($entry.Name) -ne $entry.Name) { throw 'Invalid provenance filename' }
            $actual = (Get-FileHash -LiteralPath (Join-Path $version $entry.Name) -Algorithm SHA256).Hash.ToLowerInvariant()
            if ($actual -ne $entry.Value) { throw "Installed helper hash mismatch: $($entry.Name)" }
        }
        & $Verify $version
        [IO.File]::WriteAllText($temporary,(@{schema=1;directory=$relative} | ConvertTo-Json -Compress),[Text.UTF8Encoding]::new($false))
        if (Test-Path -LiteralPath $active) { [IO.File]::Replace($temporary,$active,[NullString]::Value) }
        else { [IO.File]::Move($temporary,$active) }
        return Join-Path $version 'computer-custom-helper.exe'
    } catch {
        $originalFailure = $_
        # The absolute child path was verified above. Never remove active/older versions.
        try { if (Test-Path -LiteralPath $version) { Remove-Item -LiteralPath $version -Recurse -Force } }
        catch { Write-Warning "Rejected candidate cleanup is pending at ${version}: $($_.Exception.Message)" }
        throw $originalFailure
    } finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
    }
}
