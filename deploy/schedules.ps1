[CmdletBinding()]
param([Parameter(Mandatory)][string]$ConfigFile)
$ErrorActionPreference = 'Stop'
$cfg = Get-Content -LiteralPath $ConfigFile -Raw | ConvertFrom-Json
foreach ($name in @('projectId','region','servicePrefix','scheduleTimezone','ingestSchedule','cleanupSchedule','popularSchedule')) {
  if (-not $cfg.$name -or $cfg.$name -match 'REPLACE_WITH') { throw "Configure $name first." }
}
function Invoke-GCloud {
  param([Parameter(ValueFromRemainingArguments)][string[]]$Arguments)
  & gcloud @Arguments --project=$($cfg.projectId) --quiet
  if ($LASTEXITCODE -ne 0) { throw 'Scheduler operation failed; inspect the named environment.' }
}
foreach ($kind in @('ingest','cleanup','popular')) {
  $job = "$($cfg.servicePrefix)-$kind"
  $schedule = $cfg."$($kind)Schedule"
  & gcloud scheduler jobs describe $job --project=$($cfg.projectId) --location=$($cfg.region) 2>$null | Out-Null
  $verb = if ($LASTEXITCODE -eq 0) { 'update' } else { 'create' }
  Invoke-GCloud scheduler jobs $verb http $job --location=$($cfg.region) --schedule=$schedule --time-zone=$($cfg.scheduleTimezone) --uri="https://run.googleapis.com/v2/projects/$($cfg.projectId)/locations/$($cfg.region)/jobs/${job}:run" --http-method=POST --oauth-service-account-email="$($cfg.servicePrefix)-scheduler@$($cfg.projectId).iam.gserviceaccount.com" --headers=Content-Type=application/json --message-body='{}' --max-retry-attempts=1
  Invoke-GCloud scheduler jobs pause $job --location=$($cfg.region)
}
Write-Output 'Schedules created/updated and paused. Resume each only after a bounded, approved staging execution. Cleanup should be the first schedule enabled once permitted data exists.'
