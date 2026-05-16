param(
  [switch]$SkipTests,
  [switch]$SkipBuild,
  [switch]$SkipDocker,
  [switch]$NoCache,
  [string]$ImageTag = ""
)

$ErrorActionPreference = "Stop"

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Require-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command '$Name' was not found on PATH."
  }
}

function Invoke-Logged {
  param(
    [string]$FilePath,
    [string[]]$Arguments
  )

  Write-Host "+ $FilePath $($Arguments -join ' ')" -ForegroundColor DarkGray
  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($Arguments -join ' ')"
  }
}

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $repoRoot

Require-Command "git"
Require-Command "pnpm"

$gitSha = (git rev-parse HEAD).Trim()
$shortSha = (git rev-parse --short=7 HEAD).Trim()

if (-not $ImageTag) {
  $ImageTag = "timedata:local-sha-$shortSha"
}

Write-Host "Repository: $repoRoot"
Write-Host "Git SHA:    $gitSha"
Write-Host "Image tag:  $ImageTag"

if (-not $SkipTests) {
  Write-Step "Run workspace tests"
  Invoke-Logged "pnpm" @("test")
}

if (-not $SkipBuild) {
  Write-Step "Run workspace build"
  Invoke-Logged "pnpm" @("build")
}

if (-not $SkipDocker) {
  Require-Command "docker"

  Write-Step "Check Docker Buildx"
  Invoke-Logged "docker" @("buildx", "version")

  Write-Step "Build the GitHub Actions Docker image locally"
  $dockerArgs = @(
    "buildx", "build",
    "--file", "packages/server/Dockerfile",
    "--build-arg", "GIT_SHA=$gitSha",
    "--tag", $ImageTag,
    "--load",
    "."
  )

  if ($NoCache) {
    $dockerArgs = @(
      "buildx", "build",
      "--no-cache",
      "--file", "packages/server/Dockerfile",
      "--build-arg", "GIT_SHA=$gitSha",
      "--tag", $ImageTag,
      "--load",
      "."
    )
  }

  Invoke-Logged "docker" $dockerArgs

  Write-Step "Inspect built image"
  Invoke-Logged "docker" @("image", "inspect", $ImageTag, "--format", "{{.Id}} {{.Config.Env}}")
}

Write-Host ""
Write-Host "Local GitHub Actions check passed." -ForegroundColor Green
