---
name: deploy-lambda
description: "Deploy AWS Lambdas using the guaranteed deploy scripts only. Never deploy via IAC (CDK). Requires AWS SSO login first. Use when deploying any AWS Lambda repo."
---

# AWS Lambda Deploy

Lambdas are deployed **only** via the project's deploy scripts, using **AWS CLI**. No CDK deploy, no IAC apply.

## Step 1: Detect guaranteed scripts before deploy

From the Lambda repo root, inspect `./scripts/` for guaranteed deploy scripts.

Preferred script names:

- Single function: `deploy-lambda-guaranteed.sh`
- All functions: `deploy-all-lambdas-guaranteed.sh`

Accept equivalent variants only if they are clearly the same guaranteed flow.

## Rule: Use the guaranteed deploy scripts

Each Lambda repo that has deploy scripts must use them:

- **Single function:** `./scripts/deploy-lambda-guaranteed.sh <lambda-name> [--profile PROFILE] [--region REGION]`
- **All functions in repo:** `./scripts/deploy-all-lambdas-guaranteed.sh [--profile PROFILE] [--region REGION]`

Script names may vary by repo (e.g. `deploy-lambda-guaranteed.sh`, `deploy-all-lambdas-guaranteed.sh`). Look in that repo's `scripts/` folder.

## Step 2: Mandatory fallback when scripts do not exist

If no guaranteed deploy script exists, **do not deploy manually**.

Instead, pause and ask the user before creating defaults. Use this message pattern:

`No guaranteed deploy script was found in ./scripts. I suggest creating standard deploy scripts now (single Lambda and deploy-all), based on the plugin defaults. Should I create them for this repo?`

If the user approves, create these files in the target Lambda repo:

- `./scripts/deploy-lambda-guaranteed.sh`
- `./scripts/deploy-all-lambdas-guaranteed.sh`

Template source (inside plugin):

- `assets/lambda-deploy/deploy-lambda-guaranteed.template.sh`
- `assets/lambda-deploy/deploy-all-lambdas-guaranteed.template.sh`

After creation:

1. Make scripts executable (`chmod +x`).
2. Review placeholders/TODO values with the user.
3. Run deploy through the guaranteed script only.

## Prerequisite: AWS SSO login

Before **any** AWS CLI command (including deploy):

```bash
aws sso login --profile <aws-profile>
```

Replace `<aws-profile>` with the project's AWS profile. If you skip this, deploy will fail with credential/session errors.

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
