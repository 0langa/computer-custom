# Copy a complete immutable version, validate it, then atomically activate it.
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
        # The absolute child path was verified above. Never remove active/older versions.
        if (Test-Path -LiteralPath $version) { Remove-Item -LiteralPath $version -Recurse -Force }
        throw
    } finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
    }
}
