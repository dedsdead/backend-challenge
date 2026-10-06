#!/usr/bin/env bash

# Guaranteed deploy template for a single Lambda package.
# Copy this file to ./scripts/deploy-lambda-guaranteed.sh in the target Lambda repo.

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: ./scripts/deploy-lambda-guaranteed.sh <lambda-name> [--profile PROFILE] [--region REGION]

Description:
  Builds, packages, deploys, and verifies a Lambda function using AWS CLI.

Required project customizations:
  1) Set FUNCTION_PREFIX for your environment naming convention.
  2) Adjust PACKAGE_ROOT and package build command if your repo differs.
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

LAMBDA_NAME="${1:-}"
if [[ -z "$LAMBDA_NAME" ]]; then
  echo "Error: Lambda name is required."
  usage
  exit 1
fi
shift || true

AWS_PROFILE="${AWS_PROFILE:-default}"
AWS_REGION="${AWS_REGION:-us-east-1}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile)
      AWS_PROFILE="${2:-}"
      shift 2
      ;;
    --region)
      AWS_REGION="${2:-}"
      shift 2
      ;;
    *)
      echo "Error: Unknown argument '$1'."
      usage
      exit 1
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# TODO: Update package root if needed.
PACKAGE_ROOT="$REPO_ROOT/packages/$LAMBDA_NAME"

if [[ ! -d "$PACKAGE_ROOT" ]]; then
  echo "Error: Lambda package directory not found: $PACKAGE_ROOT"
  exit 1
fi

# TODO: Update with your naming convention.
FUNCTION_PREFIX="my-project"
FUNCTION_NAME="${FUNCTION_PREFIX}-${LAMBDA_NAME}"

echo "Deploying Lambda package '$LAMBDA_NAME' to function '$FUNCTION_NAME'"
echo "Profile: $AWS_PROFILE | Region: $AWS_REGION"

echo "[1/5] Building package"
(
  cd "$PACKAGE_ROOT"
  # TODO: Adjust build command for your repo.
  npm run build
)

echo "[2/5] Packaging Lambda"
# TODO: Replace with your project packaging command/script.
"$REPO_ROOT/scripts/package-lambda.sh" "$LAMBDA_NAME"

echo "[3/5] Creating deployment artifact"
ZIP_FILE="/tmp/${LAMBDA_NAME}-deploy-$(date +%s).zip"
(
  cd "$PACKAGE_ROOT/dist"
  zip -q -r "$ZIP_FILE" .
)

echo "[4/5] Updating function code"
aws lambda update-function-code \
  --function-name "$FUNCTION_NAME" \
  --zip-file "fileb://$ZIP_FILE" \
  --profile "$AWS_PROFILE" \
  --region "$AWS_REGION" \
  --output json >/dev/null

echo "[5/5] Verifying function update"
aws lambda get-function \
  --function-name "$FUNCTION_NAME" \
  --profile "$AWS_PROFILE" \
  --region "$AWS_REGION" \
  --query 'Configuration.[FunctionName,LastModified,CodeSize]' \
  --output table

rm -f "$ZIP_FILE"
echo "Success: deployment completed."
