---
description: "Deploy Lambda functions using the guaranteed deploy scripts only. Never deploy via IAC (CDK). Requires AWS SSO login first. Use when deploying any AWS Lambda repo."
---

# Deploy AWS Lambda with Guaranteed Scripts

Use this command to deploy Lambda changes safely through project-approved deploy scripts (default AWS CLI flow, no CDK/IaC deploy path unless project overrides allow).

Operational guardrails source: `AGENTS.md (#operational-guardrails)`
Optional project override source: `docs/workflow/operational-overrides.md`

## Step 1: Detect script availability

From the target Lambda repo root, inspect `./scripts/` and find the guaranteed deploy script(s):

- `deploy-lambda-guaranteed.sh`
- `deploy-all-lambdas-guaranteed.sh`

Do not continue until script availability is clear.

## Rule: Use the guaranteed deploy scripts

Each Lambda repo that has deploy scripts must use them:

- **Single function:** `./scripts/deploy-lambda-guaranteed.sh <lambda-name> [--profile PROFILE] [--region REGION]`
- **All functions in repo:** `./scripts/deploy-all-lambdas-guaranteed.sh [--profile PROFILE] [--region REGION]`

Script names may vary by repo (e.g. `deploy-lambda-guaranteed.sh`, `deploy-all-lambdas-guaranteed.sh`). Look in that repo's `scripts/` folder.

## Step 2: If scripts are missing, suggest bootstrap first

If no guaranteed deploy script exists, stop deploy execution and ask for user approval to scaffold defaults.

Use this prompt:

`No guaranteed deploy script was found in ./scripts. I suggest creating standard deploy scripts now (single Lambda and deploy-all), based on the plugin defaults. Should I create them for this repo?`

If approved, create in the target repo:

- `./scripts/deploy-lambda-guaranteed.sh`
- `./scripts/deploy-all-lambdas-guaranteed.sh`

Bootstrap templates:

- `.opencode/assets/lambda-deploy/deploy-lambda-guaranteed.template.sh`
- `.opencode/assets/lambda-deploy/deploy-all-lambdas-guaranteed.template.sh`

Then:

1. `chmod +x` both scripts.
2. Validate placeholder values and lambda list with the user.
3. Execute deploy using the guaranteed script path only.

## Prerequisite (default policy): AWS SSO login

Before AWS CLI command(s), run:

```bash
aws sso login --profile <aws-profile>
```

Replace `<aws-profile>` with the project's AWS profile (e.g. `Production`, `Staging`). If you skip this, deploy will fail with credential/session errors.

## Where to run

- **From the Lambda repo root** (e.g. `notification-processor`, `reply-suggestions-lambda`):  
  `./scripts/deploy-lambda-guaranteed.sh <name> --profile <aws-profile> --region <region>`
- Default profile and region vary by project; pass explicitly if the script supports it.

## Lambda name

The first argument is the **Lambda package/name** (e.g. `notification-processor`, `appsync-publisher`). Run the script with `--help` to see available names for that repo.

## After deploy

- Scripts typically build, package, and call `aws lambda update-function-code` (or create if missing). Idempotent and safe to re-run.
- If deploy fails, check: (1) SSO logged in, (2) correct repo and script path, (3) correct lambda name for that repo.

## Do not

- Run `cdk deploy` or any IAC to deploy Lambda code.
- Manually zip and upload unless the repo has no script and you are adding the script as part of the work.

## Next Recommended Commands

- `/pwf-review` if deploy validation highlights code risks
- `/pwf-commit-changes` to register deployment-related fixes or scripts updates
- `/pwf-doc lambda <repo-name>` when Lambda behavior changed materially
