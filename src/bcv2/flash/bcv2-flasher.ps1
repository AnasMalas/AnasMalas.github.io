<#
BCv2 easy flasher for Windows.

Run it: right-click this file and choose "Run with PowerShell".

What it does, in order:
  1. wchisp needs Microsoft's Visual C++ runtime. If it is missing, this asks
     first, downloads Microsoft's installer from aka.ms, checks that it is
     signed by Microsoft, and runs it. Windows asks for permission.
  2. Downloads wchisp v0.3.0, the open-source WCH flashing tool, from its
     GitHub release (github.com/ch32-rs/wchisp) and checks it against the
     SHA-256 hash below. It stops if the hash does not match.
  3. Downloads the latest BCv2 firmware listed at
     https://anasmalas.com/bcv2/firmware.json and checks it against the
     SHA-256 hash in that list. It stops if the hash does not match.
  4. Waits for a card in bootloader mode. The first time, Windows has no
     driver for the bootloader; this asks first, then downloads Zadig 2.9
     (the usual WinUSB driver installer, github.com/pbatard/libwdi), checks
     its hash and signature, and opens it with step-by-step instructions.
  5. Flashes and verifies the card and turns the window green (done) or
     red (failed). Repeat for more cards.

It changes no settings and installs nothing else. Everything it downloads
stays in %LOCALAPPDATA%\bcv2-flasher; delete that folder to remove it.
Close the window to quit.
#>

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$WchispVersion = 'v0.3.0'
$WchispSha256 = 'EBA605BBC62F217F6454E7236D04EF1B8A6B4396DD7CE8DC26FC83016213C3AA'
$ZadigUrl = 'https://github.com/pbatard/libwdi/releases/download/v1.5.1/zadig-2.9.exe'
$ZadigSha256 = '4ECAA95DF3DA3621486A043AEF8B3050B8BAFE7C901402871E816229EF82039B'
$VcRuntimeUrl = 'https://aka.ms/vs/17/release/vc_redist.x64.exe'
$ManifestUrl = 'https://anasmalas.com/bcv2/firmware.json'
$Cache = Join-Path $env:LOCALAPPDATA 'bcv2-flasher'

function Stop-WithMessage([string]$message) {
    Write-Host ''
    Write-Host $message -ForegroundColor Red
    Read-Host 'Press Enter to close' | Out-Null
    exit 1
}

function Read-YesNo([string]$question) {
    return (Read-Host "$question [y/N]") -match '^(y|yes)$'
}

function Save-Download([string]$url, [string]$path) {
    Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile "$path.part"
    Move-Item -Force "$path.part" $path
}

function Test-Sha256([string]$path, [string]$sha256) {
    return (Test-Path $path) -and ((Get-FileHash $path -Algorithm SHA256).Hash -eq $sha256.ToUpperInvariant())
}

function Test-Signer([string]$path, [string]$organization) {
    $signature = Get-AuthenticodeSignature $path
    return $signature.Status -eq 'Valid' -and $signature.SignerCertificate.Subject -match "O=$organization,"
}

try {
    New-Item -ItemType Directory -Force $Cache | Out-Null
    Write-Host "BCv2 flasher. Files are kept in: $Cache"

    # 1. Microsoft Visual C++ runtime, only if missing.
    if (-not (Test-Path (Join-Path $env:SystemRoot 'System32\vcruntime140.dll'))) {
        Write-Host ''
        Write-Host 'wchisp needs the Microsoft Visual C++ runtime, which is not installed.'
        if (-not (Read-YesNo 'Download it from Microsoft and install it now?')) {
            Stop-WithMessage 'Install "Microsoft Visual C++ Redistributable (x64)" from microsoft.com, then run this again.'
        }
        $installer = Join-Path $Cache 'vc_redist.x64.exe'
        Save-Download $VcRuntimeUrl $installer
        if (-not (Test-Signer $installer 'Microsoft Corporation')) {
            Remove-Item -Force $installer
            Stop-WithMessage 'That installer was not signed by Microsoft, so it was deleted and not run.'
        }
        Start-Process -FilePath $installer -ArgumentList '/install', '/passive', '/norestart' -Wait
    }

    # 2. wchisp, checked against its pinned hash.
    $zip = Join-Path $Cache "wchisp-$WchispVersion-win-x64.zip"
    if (-not (Test-Sha256 $zip $WchispSha256)) {
        Write-Host "Downloading wchisp $WchispVersion from GitHub..."
        Save-Download "https://github.com/ch32-rs/wchisp/releases/download/$WchispVersion/wchisp-$WchispVersion-win-x64.zip" $zip
    }
    if (-not (Test-Sha256 $zip $WchispSha256)) {
        Remove-Item -Force $zip
        Stop-WithMessage 'The wchisp download did not match its expected hash, so it was deleted and nothing was run.'
    }
    Expand-Archive -Force $zip $Cache
    $Wchisp = Join-Path $Cache 'wchisp-win-x64\wchisp.exe'

    # 3. Firmware, checked against the hash in the list on anasmalas.com.
    Write-Host 'Checking for the latest firmware...'
    $product = (Invoke-RestMethod -UseBasicParsing -Uri $ManifestUrl).product
    if ($product.latest -notmatch '^0x[0-9A-Fa-f]{8}$' -or
        $product.download -notlike 'https://anasmalas.com/*' -or
        $product.sha256 -notmatch '^[0-9a-f]{64}$') {
        Stop-WithMessage 'The firmware list looks wrong, so nothing was downloaded.'
    }
    $Firmware = Join-Path $Cache "bcv2-rev1-product-$($product.latest).bin"
    if (-not (Test-Sha256 $Firmware $product.sha256)) {
        Write-Host "Downloading firmware $($product.latest)..."
        Save-Download $product.download $Firmware
    }
    if (-not (Test-Sha256 $Firmware $product.sha256)) {
        Remove-Item -Force $Firmware
        Stop-WithMessage 'The firmware download did not match its expected hash, so it was deleted.'
    }
    $FirmwareName = $product.latest
} catch {
    Stop-WithMessage "Setup failed: $($_.Exception.Message)"
}

# 4. The flashing screen. A 5-row block font for the few words it shows.
$font = @{
    'A' = '01110', '10001', '11111', '10001', '10001'
    'D' = '11110', '10001', '10001', '10001', '11110'
    'E' = '11111', '10000', '11110', '10000', '11111'
    'F' = '11111', '10000', '11110', '10000', '10000'
    'G' = '01111', '10000', '10011', '10001', '01111'
    'H' = '10001', '10001', '11111', '10001', '10001'
    'I' = '11111', '00100', '00100', '00100', '11111'
    'L' = '10000', '10000', '10000', '10000', '11111'
    'N' = '10001', '11001', '10101', '10011', '10001'
    'O' = '01110', '10001', '10001', '10001', '01110'
    'P' = '11110', '10001', '11110', '10000', '10000'
    'R' = '11110', '10001', '11110', '10100', '10010'
    'S' = '01111', '10000', '01110', '00001', '11110'
    'T' = '11111', '00100', '00100', '00100', '00100'
    'U' = '10001', '10001', '10001', '10001', '01110'
    'Y' = '10001', '01010', '00100', '00100', '00100'
}
$block = [string][char]0x2588

function Write-Big([string]$word) {
    for ($row = 0; $row -lt 5; $row++) {
        $line = '  '
        foreach ($letter in $word.ToCharArray()) {
            foreach ($bit in $font[[string]$letter][$row].ToCharArray()) {
                $line += if ($bit -eq '1') { $block * 2 } else { '  ' }
            }
            $line += '  '
        }
        Write-Host $line
    }
}

function Show-Screen([string]$background, [string]$word, [string[]]$lines) {
    $Host.UI.RawUI.BackgroundColor = $background
    $Host.UI.RawUI.ForegroundColor = 'White'
    Clear-Host
    Write-Host ''
    Write-Big $word
    Write-Host ''
    foreach ($line in $lines) { Write-Host "  $line" }
    Write-Host ''
    Write-Host "  Done: $script:done   Failed: $script:failed   Firmware: $FirmwareName"
    Write-Host '  Close this window to quit.'
}

function Test-Bootloader {
    $probe = & $Wchisp probe 2>&1 | ForEach-Object { "$_" }
    foreach ($line in $probe) {
        if ($line -match 'Found (\d+) USB device') { return [int]$Matches[1] -gt 0 }
    }
    return $false
}

# Once WinUSB is installed for the bootloader (any USB port), Windows binds
# it on every port and records it here. A quick check, so the slow device
# search below only runs before the first setup.
function Test-WinUsbKnown {
    foreach ($key in Get-ChildItem 'HKLM:\SYSTEM\CurrentControlSet\Enum\USB' -ErrorAction SilentlyContinue) {
        if ($key.PSChildName -notmatch '^VID_(4348|1A86)&PID_55E0$') { continue }
        foreach ($instance in Get-ChildItem $key.PSPath -ErrorAction SilentlyContinue) {
            if ((Get-ItemProperty $instance.PSPath -ErrorAction SilentlyContinue).Service -eq 'WinUSB') { return $true }
        }
    }
    return $false
}

# A card in bootloader mode that Windows sees without the WinUSB driver.
# Takes about a second.
function Test-BootloaderWithoutDriver {
    $device = Get-CimInstance Win32_PnPEntity -ErrorAction SilentlyContinue `
        -Filter "PNPDeviceID LIKE 'USB\\VID_4348&PID_55E0%' OR PNPDeviceID LIKE 'USB\\VID_1A86&PID_55E0%'" |
        Select-Object -First 1
    return $null -ne $device -and $device.Service -ne 'WinUSB'
}

function Show-DriverSetup {
    $steps = @(
        'Windows needs a one-time driver (WinUSB) before it can flash the card.',
        '',
        '1. In Zadig, pick the device whose USB ID reads 4348 55E0 (or 1A86 55E0).',
        '   It may be called "USB Module" or "Unknown Device". Not listed? Options > List All Devices.',
        '2. Leave the driver on WinUSB and click Install Driver (or Replace Driver).',
        '3. Close Zadig when it is done. This window carries on by itself.',
        '',
        'Only change that one device. If you used WCHISPTool, it will need its own driver back.'
    )
    Show-Screen 'DarkYellow' 'SETUP' $steps
    if ($script:driverOffered) { return }
    $script:driverOffered = $true
    Write-Host ''
    if (-not (Read-YesNo '  Download Zadig 2.9 from GitHub and open it?')) {
        Show-Screen 'DarkYellow' 'SETUP' ($steps + '' + 'Get Zadig from https://zadig.akeo.ie and follow the steps above.')
        return
    }
    $zadig = Join-Path $Cache 'zadig-2.9.exe'
    if (-not (Test-Sha256 $zadig $ZadigSha256)) { Save-Download $ZadigUrl $zadig }
    if (-not (Test-Sha256 $zadig $ZadigSha256) -or -not (Test-Signer $zadig 'Akeo Consulting')) {
        Remove-Item -Force $zadig -ErrorAction SilentlyContinue
        Show-Screen 'DarkRed' 'FAILED' @('Zadig did not match its expected hash and signature, so it was deleted and not run.')
        return
    }
    Start-Process -FilePath $zadig
    Show-Screen 'DarkYellow' 'SETUP' $steps
}

# wchisp logs to stderr, which Windows PowerShell turns into errors; they
# must not stop the flasher.
$ErrorActionPreference = 'Continue'
$script:done = 0
$script:failed = 0
$script:driverOffered = $false
$originalBackground = $Host.UI.RawUI.BackgroundColor
$originalForeground = $Host.UI.RawUI.ForegroundColor
try {
    Show-Screen 'Black' 'READY' @(
        'Plug DATA into this computer, then hold BOOT and plug in POWER.',
        'If the display lights up, it missed the bootloader: unplug POWER and press BOOT harder.'
    )
    while ($true) {
        $polls = 0
        while (-not (Test-Bootloader)) {
            Start-Sleep -Milliseconds 250
            # Every five seconds, look for a card Windows has no driver for.
            if ((++$polls % 20) -eq 0 -and -not (Test-WinUsbKnown) -and (Test-BootloaderWithoutDriver)) {
                Show-DriverSetup
            }
        }
        Start-Sleep -Milliseconds 300
        Show-Screen 'DarkBlue' 'FLASHING' @('Keep the card plugged in.')

        $output = & $Wchisp flash $Firmware 2>&1 | ForEach-Object { "$_" }
        if ($LASTEXITCODE -eq 0) {
            $script:done++
            Show-Screen 'DarkGreen' 'DONE' @('Card flashed and verified.', 'Unplug it. Plug in the next one, or close this window.')
            try { [console]::Beep(880, 180); [console]::Beep(1320, 180) } catch { }
        } else {
            $script:failed++
            Show-Screen 'DarkRed' 'FAILED' (@('Unplug this card and try it again.', '') + @($output | Select-Object -Last 4))
            try { [console]::Beep(440, 180); [console]::Beep(330, 180); [console]::Beep(220, 180) } catch { }
        }
        # Keep the result up until this card leaves the bootloader.
        while (Test-Bootloader) { Start-Sleep -Milliseconds 250 }
    }
} finally {
    $Host.UI.RawUI.BackgroundColor = $originalBackground
    $Host.UI.RawUI.ForegroundColor = $originalForeground
}
