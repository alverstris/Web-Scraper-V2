[CmdletBinding()]
param([Parameter(Mandatory)][string]$ConfigFile)
$ErrorActionPreference = 'Stop'
$cfg = Get-Content -LiteralPath $ConfigFile -Raw | ConvertFrom-Json
foreach ($name in @('environment','projectId','region','firestoreLocation','bucket','artifactRepository','servicePrefix')) {
  $value = $cfg.$name
  if (-not $value -or $value -match 'REPLACE_WITH') { throw "Configure $name before provisioning." }
}
if ($cfg.environment -notin @('staging','production')) { throw 'Use a dedicated staging or production configuration.' }
if ($cfg.projectId -notmatch '^[a-z][a-z0-9-]{4,28}[a-z0-9]$') { throw 'Invalid Google project ID.' }
if ($cfg.servicePrefix -notmatch '^[a-z][a-z0-9-]{3,18}$') { throw 'Use a short lowercase service prefix (4-19 characters).' }
function Invoke-GCloud {
  param([Parameter(ValueFromRemainingArguments)][string[]]$Arguments)
  & gcloud @Arguments --project=$($cfg.projectId) --quiet
  if ($LASTEXITCODE -ne 0) { throw "gcloud failed: $($Arguments[0..([Math]::Min(2, $Arguments.Length - 1))] -join ' ')" }
}
function Exists-GCloud {
  param([Parameter(ValueFromRemainingArguments)][string[]]$Arguments)
  & gcloud @Arguments --project=$($cfg.projectId) --format='value(name)' 2>$null | Out-Null
  return $LASTEXITCODE -eq 0
}
Invoke-GCloud services enable run.googleapis.com artifactregistry.googleapis.com firestore.googleapis.com storage.googleapis.com cloudtasks.googleapis.com cloudscheduler.googleapis.com secretmanager.googleapis.com identitytoolkit.googleapis.com
foreach ($suffix in @('api','worker','jobs','tasks','scheduler')) {
  $id = "$($cfg.servicePrefix)-$suffix"
  $email = "$id@$($cfg.projectId).iam.gserviceaccount.com"
  if (-not (Exists-GCloud iam service-accounts describe $email)) {
    Invoke-GCloud iam service-accounts create $id --display-name="$($cfg.environment) commute $suffix"
  }
}
if (-not (Exists-GCloud artifacts repositories describe $cfg.artifactRepository --location=$($cfg.region))) {
  Invoke-GCloud artifacts repositories create $cfg.artifactRepository --location=$($cfg.region) --repository-format=docker
}
if (-not (Exists-GCloud firestore databases describe --database=$($cfg.firestoreDatabase))) {
  Invoke-GCloud firestore databases create --database=$($cfg.firestoreDatabase) --location=$($cfg.firestoreLocation) --type=firestore-native --delete-protection
}
$bucketUri = "gs://$($cfg.bucket)"
if (-not (Exists-GCloud storage buckets describe $bucketUri)) {
  Invoke-GCloud storage buckets create $bucketUri --location=$($cfg.region) --uniform-bucket-level-access --public-access-prevention
}
# GCS bucket names are global: --project does not constrain an existing bucket target.
$expectedProjectNumber = & gcloud projects describe $cfg.projectId --format='value(projectNumber)'
if ($LASTEXITCODE -ne 0) { throw 'Cannot verify environment project number.' }
$bucketJson = & gcloud storage buckets describe $bucketUri --format=json
if ($LASTEXITCODE -ne 0) { throw 'Cannot verify bucket ownership.' }
$bucketInfo = $bucketJson | ConvertFrom-Json
$bucketProject = $bucketInfo.project_number
if (-not $bucketProject) { $bucketProject = $bucketInfo.projectNumber }
if (-not $bucketProject -or [string]$bucketProject -ne [string]$expectedProjectNumber) { throw 'Bucket is outside the configured environment project or ownership could not be verified.' }
Invoke-GCloud storage buckets update $bucketUri --public-access-prevention --uniform-bucket-level-access --no-versioning --clear-soft-delete
foreach ($suffix in @('api','worker','jobs')) {
  $member = "serviceAccount:$($cfg.servicePrefix)-$suffix@$($cfg.projectId).iam.gserviceaccount.com"
  Invoke-GCloud projects add-iam-policy-binding $cfg.projectId --member=$member --role=roles/datastore.user --condition=None
  Invoke-GCloud storage buckets add-iam-policy-binding $bucketUri --member=$member --role=roles/storage.objectUser
}
$api = "$($cfg.servicePrefix)-api@$($cfg.projectId).iam.gserviceaccount.com"
$tasks = "$($cfg.servicePrefix)-tasks@$($cfg.projectId).iam.gserviceaccount.com"
Invoke-GCloud projects add-iam-policy-binding $cfg.projectId --member="serviceAccount:$api" --role=roles/firebaseauth.viewer --condition=None
foreach ($suffix in @('api','worker','jobs')) {
  $caller = "$($cfg.servicePrefix)-$suffix@$($cfg.projectId).iam.gserviceaccount.com"
  Invoke-GCloud projects add-iam-policy-binding $cfg.projectId --member="serviceAccount:$caller" --role=roles/cloudtasks.enqueuer --condition=None
  Invoke-GCloud iam service-accounts add-iam-policy-binding $tasks --member="serviceAccount:$caller" --role=roles/iam.serviceAccountUser
}
$queue = "$($cfg.servicePrefix)-routing"
if (-not (Exists-GCloud tasks queues describe $queue --location=$($cfg.region))) {
  Invoke-GCloud tasks queues create $queue --location=$($cfg.region)
}
Invoke-GCloud tasks queues update $queue --location=$($cfg.region) --max-concurrent-dispatches=2 --max-dispatches-per-second=2 --max-attempts=5 --min-backoff=10s --max-backoff=300s
Invoke-GCloud tasks queues pause $queue --location=$($cfg.region)
foreach ($secret in @("$($cfg.servicePrefix)-edge", "$($cfg.servicePrefix)-evidence", "$($cfg.servicePrefix)-turnstile")) {
  if (-not (Exists-GCloud secrets describe $secret)) { Invoke-GCloud secrets create $secret --replication-policy=automatic }
  Invoke-GCloud secrets add-iam-policy-binding $secret --member="serviceAccount:$api" --role=roles/secretmanager.secretAccessor
}
if ($cfg.providerSecrets) {
  foreach ($mapping in $cfg.providerSecrets.PSObject.Properties) {
    if ($mapping.Name -notmatch '^[A-Z][A-Z0-9_]+$' -or $mapping.Value -notmatch '^([a-zA-Z0-9_-]+):\d+$') { throw 'Provider secret mappings require ENV_NAME -> secret-name:numeric-version.' }
    $secret = ($mapping.Value -split ':')[0]
    if (-not $secret.StartsWith("$($cfg.servicePrefix)-")) { throw 'Provider secrets must use this environment service prefix.' }
    if (-not (Exists-GCloud secrets describe $secret)) { Invoke-GCloud secrets create $secret --replication-policy=automatic }
    foreach ($suffix in @('api','worker','jobs')) {
      $member = "serviceAccount:$($cfg.servicePrefix)-$suffix@$($cfg.projectId).iam.gserviceaccount.com"
      Invoke-GCloud secrets add-iam-policy-binding $secret --member=$member --role=roles/secretmanager.secretAccessor
    }
  }
}
Write-Output 'Infrastructure provisioned with routing queue paused. Add independent secret versions through Secret Manager, configure Firebase Auth and deploy services only after the gates review.'
