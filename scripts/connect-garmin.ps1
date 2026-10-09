param([switch]$Sync, [switch]$Full)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
$syncRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$configFile = Join-Path $syncRoot '.tools\garmin-sync-config.bin'
$pythonFile = Join-Path $syncRoot '.tools\garmin-venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $configFile) -or -not (Test-Path -LiteralPath $pythonFile)) {
    throw 'Falta preparar el entorno local del sincronizador. Consulta SYNC.md.'
}
$configBytes = [System.Security.Cryptography.ProtectedData]::Unprotect(
    [System.IO.File]::ReadAllBytes($configFile), $null,
    [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
$syncConfig = [System.Text.Encoding]::UTF8.GetString($configBytes) | ConvertFrom-Json
$env:GARMIN_API_URL = $syncConfig.GARMIN_API_URL
$env:GARMIN_SYNC_KEY = $syncConfig.GARMIN_SYNC_KEY
$env:GARMIN_SESSION_KEY = $syncConfig.GARMIN_SESSION_KEY
try {
    if ($Sync) {
        $syncArgs = @((Join-Path $syncRoot 'sync\runner.py'))
        if ($Full) { $syncArgs += '--full' }
        & $pythonFile @syncArgs
    } else {
        & $pythonFile (Join-Path $syncRoot 'sync\connect.py')
    }
    $syncExitCode = $LASTEXITCODE
} finally {
    Remove-Item Env:GARMIN_SYNC_KEY, Env:GARMIN_SESSION_KEY -ErrorAction SilentlyContinue
    [Array]::Clear($configBytes, 0, $configBytes.Length)
}
exit $syncExitCode
