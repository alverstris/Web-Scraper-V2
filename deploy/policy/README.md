# Reviewed policy mount point

No approved live policy is supplied. After resolving the launch gates, create a validated non-secret `approved.json` in this directory or mount it at runtime. Set `POLICY_CONFIG_PATH=/app/deploy/policy/approved.json` in the reviewed cloud environment. The Dockerfile includes this directory so an approved policy can be versioned with the image. Store confidential agreements elsewhere; the policy contains their reference only.

The authoritative schema is `server/config.ts`. Its current supported policy allows a reviewed custom-run pilot only; shared popular live data and live exports remain explicitly false. An approval record does not configure or authorise a provider by itself. Rebuild/redeploy if an embedded policy changes; use its expiry to force timely re-review.
