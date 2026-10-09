$ErrorActionPreference = 'Stop'
$ymsRoot = Split-Path -Parent $PSScriptRoot
$ymsNode = (Get-Command node -ErrorAction Stop).Source
$ymsService = Start-Process -FilePath $ymsNode -ArgumentList ('"' + (Join-Path $PSScriptRoot 'local-supervisor.cjs') + '"') -WorkingDirectory $ymsRoot -WindowStyle Hidden -PassThru
$ymsService.WaitForExit()
exit $ymsService.ExitCode
