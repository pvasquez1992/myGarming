$runtimeRoot = Join-Path $PSScriptRoot '..\.tools'
$runtime = Get-ChildItem -LiteralPath $runtimeRoot -Directory -Filter 'node-v*-win-x64' -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $runtime) {
    throw 'No hay Node portable. Instala Node.js 24 LTS y usa npm normalmente.'
}
$env:Path = $runtime.FullName + [System.IO.Path]::PathSeparator + $env:Path
node --version
