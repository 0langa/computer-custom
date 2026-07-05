param(
  [string]$CodexHome = "",
  [string]$RepoRoot = ""
)

$ErrorActionPreference = "Stop"

function Get-Sha256Hex {
  param([string]$LiteralPath)

  $stream = [System.IO.File]::OpenRead($LiteralPath)
  try {
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
      $hash = $sha256.ComputeHash($stream)
      return (($hash | ForEach-Object { $_.ToString("x2") }) -join "")
    } finally {
      $sha256.Dispose()
    }
  } finally {
    $stream.Dispose()
  }
}

if ([string]::IsNullOrWhiteSpace($RepoRoot)) {
  $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
}

$resolvedRepoRoot = (Resolve-Path $RepoRoot).Path

if ([string]::IsNullOrWhiteSpace($CodexHome)) {
  if (-not [string]::IsNullOrWhiteSpace($env:CODEX_HOME)) {
    $CodexHome = $env:CODEX_HOME
  } else {
    $CodexHome = Join-Path $HOME ".codex"
  }
}

$sourceRoot = Join-Path $CodexHome "plugins\cache\openai-bundled\computer-use"
if (-not (Test-Path -LiteralPath $sourceRoot -PathType Container)) {
  throw "Bundled Computer Use plugin not found."
}

$latest = Get-ChildItem -LiteralPath $sourceRoot -Directory |
  Sort-Object -Property Name -Descending |
  Select-Object -First 1

if ($null -eq $latest) {
  throw "No bundled Computer Use versions found."
}

$snapshotRoot = Join-Path $resolvedRepoRoot "upstream\openai-bundled\computer-use\$($latest.Name)"
$resolvedSnapshotParent = Join-Path $resolvedRepoRoot "upstream\openai-bundled\computer-use"
New-Item -ItemType Directory -Force -Path $resolvedSnapshotParent | Out-Null

$resolvedSnapshotParentPath = (Resolve-Path $resolvedSnapshotParent).Path
if (-not $resolvedSnapshotParentPath.StartsWith($resolvedRepoRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "Refusing to write upstream snapshot outside repository."
}

if (Test-Path -LiteralPath $snapshotRoot) {
  Remove-Item -LiteralPath $snapshotRoot -Recurse -Force
}
Copy-Item -LiteralPath $latest.FullName -Destination $snapshotRoot -Recurse -Force

$files = Get-ChildItem -LiteralPath $snapshotRoot -File -Recurse |
  Sort-Object -Property FullName |
  ForEach-Object {
    $relative = $_.FullName.Substring($snapshotRoot.Length).TrimStart("\", "/") -replace "\\", "/"
    [pscustomobject]@{
      relativePath = $relative
      sha256 = Get-Sha256Hex -LiteralPath $_.FullName
      length = $_.Length
    }
  }

$manifest = [ordered]@{
  package = "openai-bundled/computer-use"
  version = $latest.Name
  source = "local Codex plugin cache"
  syncedAtUtc = (Get-Date).ToUniversalTime().ToString("o")
  files = $files
}

$manifestPath = Join-Path $resolvedRepoRoot "upstream\upstream-manifest.json"
New-Item -ItemType Directory -Force -Path (Split-Path $manifestPath -Parent) | Out-Null
$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $manifestPath -Encoding utf8

Write-Output "Synced openai-bundled/computer-use $($latest.Name)"
