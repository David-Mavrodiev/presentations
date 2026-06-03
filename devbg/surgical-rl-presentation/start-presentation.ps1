[CmdletBinding()]
param(
    [int]$PresentationPort = 8000,
    [int]$PolicyPort = 5000,
    [string]$Page = "index-bg.html",
    [switch]$NoOpen,
    [switch]$StrictPorts,
    [switch]$SkipPolicy,
    [switch]$RequirePolicy,
    [switch]$CheckOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSCommandPath
if ([string]::IsNullOrWhiteSpace($Root)) {
    $Root = (Get-Location).Path
}

$PolicyDir = Join-Path $Root "clip-application-surrol"
$PolicyScript = Join-Path $PolicyDir "serve_policy.py"
$PagePath = Join-Path $Root $Page
$LogDir = Join-Path $Root ".logs"

function Resolve-PythonRunner {
    $localVenvPython = Join-Path $Root ".venv\Scripts\python.exe"
    if (Test-Path $localVenvPython) {
        return [pscustomobject]@{ File = $localVenvPython; PrefixArgs = @() }
    }

    if (-not [string]::IsNullOrWhiteSpace($env:VIRTUAL_ENV)) {
        $candidates = @(
            [pscustomobject]@{ Command = "python"; PrefixArgs = @() },
            [pscustomobject]@{ Command = "python3"; PrefixArgs = @() },
            [pscustomobject]@{ Command = "py"; PrefixArgs = @("-3") }
        )
    }
    else {
        $candidates = @(
            [pscustomobject]@{ Command = "py"; PrefixArgs = @("-3") },
            [pscustomobject]@{ Command = "python"; PrefixArgs = @() },
            [pscustomobject]@{ Command = "python3"; PrefixArgs = @() }
        )
    }

    foreach ($candidate in $candidates) {
        $command = Get-Command $candidate.Command -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($null -eq $command) {
            continue
        }

        $versionArgs = @($candidate.PrefixArgs) + @("--version")
        $oldErrorActionPreference = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        try {
            $versionOutput = & $command.Source @versionArgs 2>&1
            $exitCode = $LASTEXITCODE
        }
        catch {
            continue
        }
        finally {
            $ErrorActionPreference = $oldErrorActionPreference
        }

        if ($exitCode -eq 0 -and ($versionOutput -match "Python 3\.")) {
            return [pscustomobject]@{ File = $command.Source; PrefixArgs = $candidate.PrefixArgs }
        }
    }

    throw "Python 3 was not found. Install Python 3 or create .venv before running this script."
}

function Test-TcpPortFree {
    param([int]$Port)

    $listener = $null
    try {
        $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Any, $Port)
        $listener.Start()
        return $true
    }
    catch {
        return $false
    }
    finally {
        if ($null -ne $listener) {
            $listener.Stop()
        }
    }
}

function Start-ManagedProcess {
    param(
        [string]$Name,
        [string]$FilePath,
        [string[]]$ArgumentList,
        [string]$WorkingDirectory,
        [hashtable]$Environment = @{}
    )

    New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
    $stdout = Join-Path $LogDir "$Name.out.log"
    $stderr = Join-Path $LogDir "$Name.err.log"

    $oldValues = @{}
    foreach ($key in $Environment.Keys) {
        $oldValues[$key] = [Environment]::GetEnvironmentVariable($key, "Process")
        [Environment]::SetEnvironmentVariable($key, [string]$Environment[$key], "Process")
    }

    try {
        $process = Start-Process -FilePath $FilePath `
            -ArgumentList $ArgumentList `
            -WorkingDirectory $WorkingDirectory `
            -RedirectStandardOutput $stdout `
            -RedirectStandardError $stderr `
            -PassThru
    }
    finally {
        foreach ($key in $Environment.Keys) {
            [Environment]::SetEnvironmentVariable($key, $oldValues[$key], "Process")
        }
    }

    Write-Host "Started $Name (PID $($process.Id)). Logs:"
    Write-Host "  $stdout"
    Write-Host "  $stderr"
    return $process
}

function Wait-HttpReady {
    param(
        [string]$Url,
        [int]$TimeoutSeconds = 25
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2 | Out-Null
            return $true
        }
        catch {
            Start-Sleep -Milliseconds 500
        }
    }

    return $false
}

function Stop-IfRunning {
    param([System.Diagnostics.Process[]]$Processes)

    foreach ($process in $Processes) {
        if ($null -ne $process -and -not $process.HasExited) {
            Write-Host "Stopping PID $($process.Id)..."
            Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        }
    }
}

if (-not (Test-Path $PagePath)) {
    throw "Presentation page not found: $PagePath"
}

if (-not (Test-Path $PolicyScript)) {
    throw "Policy server script not found: $PolicyScript"
}

$python = Resolve-PythonRunner
Write-Host "Project root: $Root"
Write-Host "Python: $($python.File) $($python.PrefixArgs -join ' ')"

if ($CheckOnly) {
    Write-Host "Check completed. No servers were started."
    exit 0
}

$startedProcesses = @()
$policyProcess = $null
$presentationUrl = "http://127.0.0.1:$PresentationPort/$Page"
$policyUrl = "http://127.0.0.1:$PolicyPort"

try {
    if ($SkipPolicy) {
        Write-Warning "Policy server was skipped. The deck will run, but the interactive policy demo will not call $policyUrl."
    }
    elseif (Test-TcpPortFree -Port $PolicyPort) {
        $policyArgs = @($python.PrefixArgs) + @($PolicyScript)
        $policyProcess = Start-ManagedProcess `
            -Name "policy-server" `
            -FilePath $python.File `
            -ArgumentList $policyArgs `
            -WorkingDirectory $PolicyDir `
            -Environment @{ PORT = $PolicyPort }
        $startedProcesses += $policyProcess
    }
    else {
        $message = "Port $PolicyPort is already in use; policy server was not started."
        if ($StrictPorts) { throw $message }
        Write-Warning "$message Assuming an existing policy server is available at $policyUrl."
    }

    if (Test-TcpPortFree -Port $PresentationPort) {
        $staticArgs = @($python.PrefixArgs) + @("-m", "http.server", [string]$PresentationPort, "--bind", "127.0.0.1")
        $startedProcesses += Start-ManagedProcess `
            -Name "presentation-server" `
            -FilePath $python.File `
            -ArgumentList $staticArgs `
            -WorkingDirectory $Root
    }
    else {
        $message = "Port $PresentationPort is already in use; presentation server was not started."
        if ($StrictPorts) { throw $message }
        Write-Warning "$message Assuming an existing presentation server is available at $presentationUrl."
    }

    Write-Host ""
    Write-Host "Presentation: $presentationUrl"
    Write-Host "Policy health: $policyUrl/health"
    Write-Host ""

    if (Wait-HttpReady -Url $presentationUrl -TimeoutSeconds 20) {
        Write-Host "Presentation server is ready."
    }
    else {
        Write-Warning "Presentation URL did not respond yet. Check .logs/presentation-server.err.log if it was started by this script."
    }

    if ($SkipPolicy) {
        Write-Warning "Policy health check skipped."
    }
    elseif (Wait-HttpReady -Url "$policyUrl/health" -TimeoutSeconds 30) {
        Write-Host "Policy server is ready."
    }
    else {
        $message = "Policy health endpoint did not respond. Check .logs/policy-server.err.log if it was started by this script."
        if ($RequirePolicy) { throw $message }
        Write-Warning "$message Continuing with the static presentation server."
    }

    if (-not $NoOpen) {
        Start-Process $presentationUrl
    }

    if ($startedProcesses.Count -eq 0) {
        Write-Host "No new processes were started. Exiting."
        exit 0
    }

    Write-Host ""
    Write-Host "Servers are running. Press Ctrl+C to stop the servers started by this script."

    while ($true) {
        foreach ($process in @($startedProcesses)) {
            if ($process.HasExited) {
                if ($null -ne $policyProcess -and $process.Id -eq $policyProcess.Id -and -not $RequirePolicy) {
                    Write-Warning "Policy server process exited: PID $($process.Id), exit code $($process.ExitCode). The presentation server will keep running."
                    $startedProcesses = @($startedProcesses | Where-Object { $_.Id -ne $process.Id })
                    $policyProcess = $null
                    continue
                }
                Write-Warning "A managed server process exited: PID $($process.Id), exit code $($process.ExitCode)."
                throw "One of the managed servers stopped. Check logs in $LogDir."
            }
        }
        Start-Sleep -Seconds 1
    }
}
finally {
    Stop-IfRunning -Processes $startedProcesses
}
