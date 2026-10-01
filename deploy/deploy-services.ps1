[CmdletBinding()]
param([Parameter(Mandatory)][string]$ConfigFile)
$ErrorActionPreference = 'Stop'
$cfg = Get-Content -LiteralPath $ConfigFile -Raw | ConvertFrom-Json
foreach ($name in @('projectId','region','servicePrefix','imageDigest','edgeSecretVersion','evidenceSecretVersion','turnstileSecretVersion','cloudEnvFile','scheduleTimezone')) {
  if (-not $cfg.$name -or $cfg.$name -match 'REPLACE_WITH') { throw "Configure $name before deployment." }
}
if ($cfg.environment -notin @('staging','production')) { throw 'Environment must be staging or production.' }
if ($cfg.imageDigest -notmatch '@sha256:[0-9a-f]{64}$') { throw 'Deploy an immutable image digest, not a mutable tag.' }
if ($cfg.edgeSecretVersion -notmatch '^\d+$' -or $cfg.evidenceSecretVersion -notmatch '^\d+$' -or $cfg.turnstileSecretVersion -notmatch '^\d+$') { throw 'Pin numeric secret versions for reproducible rollback.' }
$envPath = (Resolve-Path -LiteralPath $cfg.cloudEnvFile).Path
$envText = Get-Content -LiteralPath $envPath -Raw
if ($envText -match 'REPLACE_WITH|APP_MODE:\s*["'']?demo') { throw 'Cloud deployment requires a completed, live-mode environment file.' }
foreach ($key in @('FIREBASE_PROJECT_ID','GOOGLE_CLOUD_PROJECT')) {
  $match = [regex]::Match($envText, "(?m)^${key}:\s*[`"']?([^`"'\s#]+)[`"']?\s*$")
  if (-not $match.Success -or $match.Groups[1].Value -ne $cfg.projectId) { throw "$key must match the configured environment project." }
}
function Invoke-GCloud {
  param([Parameter(ValueFromRemainingArguments)][string[]]$Arguments)
  & gcloud @Arguments --project=$($cfg.projectId) --quiet
  if ($LASTEXITCODE -ne 0) { throw "gcloud failed for $($Arguments[0]). Stop; inspect Cloud Run revision and keep the queue paused." }
}
$common = @("--region=$($cfg.region)", "--image=$($cfg.imageDigest)", "--env-vars-file=$envPath")
$worker = "$($cfg.servicePrefix)-worker"
$api = "$($cfg.servicePrefix)-api"
$tasksEmail = "$($cfg.servicePrefix)-tasks@$($cfg.projectId).iam.gserviceaccount.com"
$providerMappings = @()
if ($cfg.providerSecrets) {
  foreach ($mapping in $cfg.providerSecrets.PSObject.Properties) {
    if ($mapping.Name -notmatch '^[A-Z][A-Z0-9_]+$' -or $mapping.Value -notmatch '^[a-zA-Z0-9_-]+:\d+$' -or -not $mapping.Value.StartsWith("$($cfg.servicePrefix)-")) { throw 'Provider secrets must be environment-prefixed, numeric-version Secret Manager references.' }
    if ($mapping.Name -in @('EDGE_ORIGIN_SECRET','EVIDENCE_HMAC_KEY','TURNSTILE_SECRET')) { throw 'Provider mappings cannot override API trust-boundary secrets.' }
    $providerMappings += "$($mapping.Name)=$($mapping.Value)"
  }
}
$providerArgs = if ($providerMappings.Count) { @("--set-secrets=$($providerMappings -join ',')") } else { @('--clear-secrets') }
Invoke-GCloud run deploy $worker @common @providerArgs --no-allow-unauthenticated --service-account="$worker@$($cfg.projectId).iam.gserviceaccount.com" --command=node '--args=--import,tsx,server/worker-main.ts' --concurrency=1 --max-instances=2 --timeout=300 --memory=512Mi --cpu=1
Invoke-GCloud run services add-iam-policy-binding $worker --region=$($cfg.region) --member="serviceAccount:$tasksEmail" --role=roles/run.invoker
# API is internet-reachable for Cloudflare but authenticates X-Edge-Secret before API work.
# Firebase Authorization is verified independently by the application for protected routes.
$apiMappings = @("EDGE_ORIGIN_SECRET=$($cfg.servicePrefix)-edge:$($cfg.edgeSecretVersion)", "EVIDENCE_HMAC_KEY=$($cfg.servicePrefix)-evidence:$($cfg.evidenceSecretVersion)", "TURNSTILE_SECRET=$($cfg.servicePrefix)-turnstile:$($cfg.turnstileSecretVersion)") + $providerMappings
Invoke-GCloud run deploy $api @common --allow-unauthenticated --service-account="$api@$($cfg.projectId).iam.gserviceaccount.com" --concurrency=40 --max-instances=3 --timeout=30 --memory=512Mi --cpu=1 --set-secrets="$($apiMappings -join ',')"
foreach ($kind in @('ingest','cleanup','popular')) {
  $job = "$($cfg.servicePrefix)-$kind"
  Invoke-GCloud run jobs deploy $job @common @providerArgs --service-account="$($cfg.servicePrefix)-jobs@$($cfg.projectId).iam.gserviceaccount.com" --command=node --args="--import,tsx,server/jobs.ts,$kind" --tasks=1 --parallelism=1 --max-retries=1 --task-timeout=900s --memory=512Mi --cpu=1
  Invoke-GCloud run jobs add-iam-policy-binding $job --region=$($cfg.region) --member="serviceAccount:$($cfg.servicePrefix)-scheduler@$($cfg.projectId).iam.gserviceaccount.com" --role=roles/run.invoker
}
Write-Output 'Services deployed. Scheduler creation and queue resume are separate operational steps; see docs/runbook.md. Keep Cloudflare API_ENABLED=false until staging smoke tests pass.'
