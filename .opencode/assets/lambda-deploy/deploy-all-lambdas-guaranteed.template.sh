#!/usr/bin/env bash

# Guaranteed deploy template for deploying all Lambda packages in a repo.
# Copy this file to ./scripts/deploy-all-lambdas-guaranteed.sh in the target Lambda repo.

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: ./scripts/deploy-all-lambdas-guaranteed.sh [--profile PROFILE] [--region REGION]

Description:
  Iterates through the project Lambda list and deploys each one using
  ./scripts/deploy-lambda-guaranteed.sh.
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

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
SINGLE_DEPLOY_SCRIPT="$SCRIPT_DIR/deploy-lambda-guaranteed.sh"

if [[ ! -x "$SINGLE_DEPLOY_SCRIPT" ]]; then
  echo "Error: Missing executable $SINGLE_DEPLOY_SCRIPT"
  echo "Create it first, then run this script again."
  exit 1
fi

# TODO: Replace with the Lambda package list for this repo.
ALL_LAMBDAS=(
  "example-lambda-a"
  "example-lambda-b"
)

if [[ "${#ALL_LAMBDAS[@]}" -eq 0 ]]; then
  echo "Error: ALL_LAMBDAS list is empty."
  exit 1
fi

SUCCESS=0
FAILED=0
FAILED_NAMES=()

echo "Deploying ${#ALL_LAMBDAS[@]} Lambda package(s)"
echo "Profile: $AWS_PROFILE | Region: $AWS_REGION"

for lambda_name in "${ALL_LAMBDAS[@]}"; do
  echo "----------------------------------------"
  echo "Deploying: $lambda_name"

  if "$SINGLE_DEPLOY_SCRIPT" "$lambda_name" --profile "$AWS_PROFILE" --region "$AWS_REGION"; then
    SUCCESS=$((SUCCESS + 1))
    echo "Result: SUCCESS ($lambda_name)"
  else
    FAILED=$((FAILED + 1))
    FAILED_NAMES+=("$lambda_name")
    echo "Result: FAILED ($lambda_name)"
  fi
done

echo "----------------------------------------"
echo "Summary: success=$SUCCESS failed=$FAILED total=${#ALL_LAMBDAS[@]}"

if [[ "$FAILED" -gt 0 ]]; then
  echo "Failed packages:"
  for name in "${FAILED_NAMES[@]}"; do
    echo "  - $name"
  done
  exit 1
fi

echo "Success: all Lambda deployments completed."
