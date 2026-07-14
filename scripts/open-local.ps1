$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
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

$port = $preferredPort
while (-not (Test-PortAvailable -Port $port)) {
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

$serverProcess = $null
try {
    $serverProcess = Start-Process `
        -FilePath $pythonExe `
        -ArgumentList @("-m", "http.server", "$port", "--bind", "127.0.0.1") `
        -WorkingDirectory $root `
        -NoNewWindow `
        -PassThru

    if (-not (Wait-ServerReady -Port $port)) {
        throw "The local server did not start on $url within 10 seconds."
    }

    Write-Host "Server is ready. Opening browser..."
    Start-Process $url
    Write-Host ""
    Write-Host "Keep this window open while using Quick Crystal."
    Write-Host "Close this window or press Ctrl+C to stop the local server."
    Wait-Process -Id $serverProcess.Id
} finally {
    if ($serverProcess -and -not $serverProcess.HasExited) {
        Stop-Process -Id $serverProcess.Id -Force -ErrorAction SilentlyContinue
    }
}
