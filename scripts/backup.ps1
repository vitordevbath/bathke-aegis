# Creates a clean bathke-aegis-bootstrap.zip next to the repository.
# Excludes VCS data, dependencies, build output and every protected resource
# (same rules as the Aegis MCP secret guard; .env.example is kept).
$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
$parent = Split-Path -Parent $repo
$name = Split-Path -Leaf $repo
$output = Join-Path $parent 'bathke-aegis-bootstrap.zip'

$skippedDirs = '^(\.git|node_modules|dist|build|coverage|target|secrets|credentials)$'
$protectedFile = '^(\.env|\.env\..+|.+\.(pem|key|p12|pfx|log|zip|tsbuildinfo))$'

$files = Get-ChildItem -Path $repo -Recurse -File -Force | Where-Object {
  $relative = $_.FullName.Substring($repo.Length + 1)
  $segments = $relative -split '[\\/]'
  $dirs = if ($segments.Length -gt 1) { $segments[0..($segments.Length - 2)] } else { @() }
  $isEnvExample = $_.Name -eq '.env.example'
  -not ($dirs | Where-Object { $_ -match $skippedDirs }) -and ($isEnvExample -or $_.Name -notmatch $protectedFile)
} | ForEach-Object { Join-Path $name $_.FullName.Substring($repo.Length + 1) }

$list = New-TemporaryFile
try {
  [System.IO.File]::WriteAllLines($list.FullName, [string[]]$files)
  if (Test-Path $output) { Remove-Item $output -Confirm:$false }
  # bsdtar ships with Windows 10+ and most Linux distributions; -a selects zip from the extension.
  # Prefer the Windows bsdtar explicitly: Git for Windows puts GNU tar (no zip support) first on PATH.
  $tar = if ($env:SystemRoot -and (Test-Path "$env:SystemRoot\System32\tar.exe")) { "$env:SystemRoot\System32\tar.exe" } else { 'bsdtar' }
  & $tar -a -c -f $output -C $parent -T $list.FullName
  if ($LASTEXITCODE -ne 0) { throw "tar failed with exit code $LASTEXITCODE" }
} finally {
  Remove-Item $list.FullName -Confirm:$false
}

Write-Output "Backup written to $output ($($files.Count) files)"
