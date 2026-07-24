$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$rootFullPath = [System.IO.Path]::GetFullPath($root).TrimEnd(
    [System.IO.Path]::DirectorySeparatorChar,
    [System.IO.Path]::AltDirectorySeparatorChar
)
$serverMarkerName = ".quick-crystal-server.json"
$preferredPort = 8765

function Test-PortAvailable {
    param([int]$Port)
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse("127.0.0.1"), $Port)
    try {
        $listener.Start()
        return $true
    } catch {
        return $false
    } finally {
        $listener.Stop()
    }
}

function Get-PythonExecutable {
    if (Get-Command py -ErrorAction SilentlyContinue) {
        $resolved = (& py -3 -c "import sys; print(sys.executable)" 2>$null | Select-Object -First 1)
        if ($resolved -and (Test-Path -LiteralPath $resolved)) {
            return $resolved
        }
    }

    foreach ($candidate in @("python", "python3")) {
        $command = Get-Command $candidate -ErrorAction SilentlyContinue
        if (-not $command) { continue }
        $resolved = (& $candidate -c "import sys; print(sys.executable)" 2>$null | Select-Object -First 1)
        if ($resolved -and (Test-Path -LiteralPath $resolved)) {
            return $resolved
        }
    }

    throw "Python was not found. Install Python, then run this launcher again."
}

function Wait-ServerReady {
    param(
        [int]$Port,
        [int]$TimeoutSeconds = 10
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $client = [System.Net.Sockets.TcpClient]::new()
            $connect = $client.BeginConnect("127.0.0.1", $Port, $null, $null)
            if ($connect.AsyncWaitHandle.WaitOne(250)) {
                $client.EndConnect($connect)
                $client.Close()
                return $true
            }
            $client.Close()
        } catch {
            Start-Sleep -Milliseconds 150
        }
    }

    return $false
}

function Write-ServerMarker {
    $markerPath = Join-Path $root $serverMarkerName
    $marker = [ordered]@{
        app = "Quick Crystal"
        root = $rootFullPath
    }
    $marker | ConvertTo-Json -Compress | Set-Content -LiteralPath $markerPath -Encoding UTF8
}

function Test-QuickCrystalServer {
    param([int]$Port)

    try {
        $markerResponse = Invoke-WebRequest `
            -Uri "http://127.0.0.1:$Port/$serverMarkerName" `
            -UseBasicParsing `
            -TimeoutSec 2
        if ($markerResponse.StatusCode -ne 200) {
            return $false
        }

        $marker = $markerResponse.Content | ConvertFrom-Json
        if ($marker.app -ne "Quick Crystal" -or -not $marker.root) {
            return $false
        }

        $servedRoot = [System.IO.Path]::GetFullPath([string]$marker.root).TrimEnd(
            [System.IO.Path]::DirectorySeparatorChar,
            [System.IO.Path]::AltDirectorySeparatorChar
        )
        if (-not [string]::Equals($servedRoot, $rootFullPath, [System.StringComparison]::OrdinalIgnoreCase)) {
            return $false
        }

        $indexResponse = Invoke-WebRequest `
            -Uri "http://127.0.0.1:$Port/src/index.html" `
            -UseBasicParsing `
            -TimeoutSec 2
        return $indexResponse.StatusCode -eq 200 -and $indexResponse.Content -match "<title>Quick Crystal</title>"
    } catch {
        return $false
    }
}

Write-ServerMarker

$port = $preferredPort
while (-not (Test-PortAvailable -Port $port)) {
    if (Test-QuickCrystalServer -Port $port) {
        $url = "http://127.0.0.1:$port/src/index.html"
        Write-Host "Quick Crystal local server is already running. Opening browser..."
        Start-Process $url
        exit 0
    }

    $port += 1
    if ($port -gt 8799) {
        throw "No available local port found between 8765 and 8799."
    }
}

$pythonExe = Get-PythonExecutable
$url = "http://127.0.0.1:$port/src/index.html"

Write-Host "Starting Quick Crystal local server..."
Write-Host "Project: $root"
Write-Host "URL:     $url"
Write-Host ""

$serverProcess = Start-Process `
    -FilePath $pythonExe `
    -ArgumentList @("-m", "http.server", "$port", "--bind", "127.0.0.1") `
    -WorkingDirectory $root `
    -WindowStyle Hidden `
    -PassThru

if (-not (Wait-ServerReady -Port $port)) {
    if ($serverProcess -and -not $serverProcess.HasExited) {
        Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue
    }
    throw "The local server did not start on $url within 10 seconds."
}

Write-Host "Server is running in the background. Opening browser..."
Start-Process $url
