param (
    [string]$ImportDir = "csv_import2db"
)

# Navigate to the project root directory
Set-Location -Path $PSScriptRoot\..

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "       CSV Database Importer Tool        " -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""

# Ensure import directory exists
$ImportDirPath = Resolve-Path -Path $ImportDir -ErrorAction SilentlyContinue
if (-not $ImportDirPath) {
    New-Item -ItemType Directory -Path $ImportDir -Force | Out-Null
    Write-Host "Created folder 'csv_import2db'. Please put your CSV files there." -ForegroundColor Yellow
    Write-Host "Press any key to exit..."
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    exit
}

# Scan for CSV files
$CsvFiles = Get-ChildItem -Path $ImportDir -Filter "*.csv"
if ($CsvFiles.Count -eq 0) {
    Write-Host "No CSV files found in '$ImportDir'." -ForegroundColor Yellow
    Write-Host "Please add a file formatted as <name>,<rating> and run again."
    Write-Host "Press any key to exit..."
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    exit
}

Write-Host "Available CSV Files:" -ForegroundColor Green
for ($i = 0; $i -lt $CsvFiles.Count; $i++) {
    Write-Host "  [$($i + 1)] $($CsvFiles[$i].Name)"
}
Write-Host ""

$CsvChoice = Read-Host "Enter the number of the CSV file to import"
$CsvIndex = [int]$CsvChoice - 1

if ($CsvIndex -lt 0 -or $CsvIndex -ge $CsvFiles.Count) {
    Write-Host "Invalid selection. Exiting." -ForegroundColor Red
    exit
}

$SelectedCsv = $CsvFiles[$CsvIndex].FullName
Write-Host ""

# Scan for databases
$Databases = Get-ChildItem -Path "data" -Filter "*.db" | Where-Object { $_.Name -notmatch "watchlist" }
if ($Databases.Count -eq 0) {
    Write-Host "No suitable databases found in 'data/' folder." -ForegroundColor Red
    exit
}

Write-Host "Available Target Databases:" -ForegroundColor Green
for ($i = 0; $i -lt $Databases.Count; $i++) {
    Write-Host "  [$($i + 1)] $($Databases[$i].Name)"
}
Write-Host ""

$DbChoice = Read-Host "Enter the number of the target database"
$DbIndex = [int]$DbChoice - 1

if ($DbIndex -lt 0 -or $DbIndex -ge $Databases.Count) {
    Write-Host "Invalid selection. Exiting." -ForegroundColor Red
    exit
}

$SelectedDbName = $Databases[$DbIndex].Name
$DbType = "movie"
if ($SelectedDbName -match "anime") {
    $DbType = "anime"
}

Write-Host ""
Write-Host "Starting import process..." -ForegroundColor Cyan
Write-Host "File: $SelectedCsv"
Write-Host "Target: $SelectedDbName ($DbType)"
Write-Host "=========================================" -ForegroundColor Cyan

# Run the node script
node scripts/import_csv.js $DbType $SelectedCsv

Write-Host ""
Write-Host "Press any key to exit..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
