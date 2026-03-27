param(
  [switch]$Staged
)

$ErrorActionPreference = 'Stop'

function Get-TargetFiles {
  if ($Staged) {
    $files = git diff --cached --name-only --diff-filter=ACMR
  } else {
    $files = git ls-files --cached --others --exclude-standard
  }
  $files |
    Where-Object { $_ -match '\.(html|js|md|css|json)$' } |
    Sort-Object -Unique
}

$badMojibake = [regex]'(Ã.|Â.|â€|â€”|â€“|â€¦|â€¢|�)'
$utf8Strict = New-Object System.Text.UTF8Encoding($false, $true)
$bad = @()
$suspiciousPatterns = @(
  @{ Name = "SUSPICIOUS SORT GLYPH"; Regex = [regex]"content:\s*'\?'"; FileRegex = '(^|\\)index\.html$' },
  @{ Name = "SUSPICIOUS RATIO TOKEN"; Regex = [regex]"\b\d\?\d\b"; FileRegex = '\.(html|md)$' },
  @{ Name = "SUSPICIOUS HEADER TOKEN"; Regex = [regex]"COST/EA\s+\?"; FileRegex = '\.(html|js)$' }
)

foreach ($f in Get-TargetFiles) {
  if (-not (Test-Path $f)) { continue }

  try {
    $bytes = [System.IO.File]::ReadAllBytes((Resolve-Path $f))
    [void]$utf8Strict.GetString($bytes)
  } catch {
    $bad += "INVALID UTF-8: $f"
    continue
  }

  $txt = [System.IO.File]::ReadAllText((Resolve-Path $f), [System.Text.Encoding]::UTF8)
  if ($badMojibake.IsMatch($txt)) {
    $bad += "MOJIBAKE PATTERN: $f"
  }

  foreach ($rule in $suspiciousPatterns) {
    if ($f -notmatch $rule.FileRegex) { continue }
    if ($rule.Regex.IsMatch($txt)) {
      $bad += "$($rule.Name): $f"
    }
  }
}

if ($bad.Count -gt 0) {
  Write-Host 'Text integrity check failed:' -ForegroundColor Red
  $bad | ForEach-Object { Write-Host " - $_" -ForegroundColor Red }
  Write-Host 'Fix encoding/mojibake before commit.' -ForegroundColor Yellow
  exit 1
}

Write-Host 'Text integrity check passed.' -ForegroundColor Green
exit 0
