$InputJson = [Console]::In.ReadToEnd()
$InputJson | & node (Join-Path $PSScriptRoot "ponytail-statusline.js")
exit $LASTEXITCODE
