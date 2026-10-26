$ErrorActionPreference = 'Stop'

# Per-machine MSI from the GitHub release (Chocolatey runs elevated; the per-user NSIS installer would land in the
# admin's profile). sha256 from the release API, re-checked locally.
$packageArgs = @{
  packageName    = $env:ChocolateyPackageName
  fileType       = 'msi'
  url64bit       = 'https://github.com/krocon/comic-commander-tauri/releases/download/v1.0.1/Comic.Commander_1.0.1_x64_en-US.msi'
  checksum64     = 'f5dc02010f1a27d270b7b0de5893f9bed4ef9a5036203b6b00970ec787035215'
  checksumType64 = 'sha256'
  softwareName   = 'Comic Commander*'
  silentArgs     = "/qn /norestart /l*v `"$($env:TEMP)\$($env:ChocolateyPackageName).$($env:ChocolateyPackageVersion).MsiInstall.log`""
  validExitCodes = @(0, 3010, 1641)
}

Install-ChocolateyPackage @packageArgs
