#!/usr/bin/env bash
set -euo pipefail

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_cmd curl
require_cmd jq

GRAFANA_URL="${GRAFANA_URL:-http://localhost:3000}"
GRAFANA_ADMIN_USER="${GRAFANA_ADMIN_USER:-admin}"
GRAFANA_ADMIN_PASS="${GRAFANA_ADMIN_PASS:-admin}"
SLO_GRAFANA_SERVICE_ACCOUNT="${SLO_GRAFANA_SERVICE_ACCOUNT:-slo-control-plane}"
SLO_GRAFANA_SERVICE_ACCOUNT_ROLE="${SLO_GRAFANA_SERVICE_ACCOUNT_ROLE:-Admin}"
SLO_GRAFANA_TOKEN_NAME="${SLO_GRAFANA_TOKEN_NAME:-slo-control-plane-token}"
SLO_GRAFANA_FOLDER_UID="${SLO_GRAFANA_FOLDER_UID:-slo-managed}"
OUTPUT_FILE="${OUTPUT_FILE:-docker/.env.slo}"
GRAFANA_BOOTSTRAP_MAX_RETRIES="${GRAFANA_BOOTSTRAP_MAX_RETRIES:-30}"
GRAFANA_BOOTSTRAP_RETRY_DELAY_SEC="${GRAFANA_BOOTSTRAP_RETRY_DELAY_SEC:-2}"

wait_for_grafana() {
  local attempt=1
  local max_attempts="${GRAFANA_BOOTSTRAP_MAX_RETRIES}"
  local delay="${GRAFANA_BOOTSTRAP_RETRY_DELAY_SEC}"
  while (( attempt <= max_attempts )); do
    if curl -sS -u "${GRAFANA_ADMIN_USER}:${GRAFANA_ADMIN_PASS}" \
      "${GRAFANA_URL}/api/health" >/dev/null 2>&1; then
      return 0
    fi
    echo "Grafana not ready yet (attempt ${attempt}/${max_attempts}), retrying in ${delay}s..."
    sleep "${delay}"
    attempt=$((attempt + 1))
  done
  echo "Grafana did not become ready after ${max_attempts} attempts." >&2
  return 1
}

api() {
  local method="$1"
  local path="$2"
  local data="${3:-}"
  local response body status
  if [[ -n "${data}" ]]; then
    response="$(curl -sS -u "${GRAFANA_ADMIN_USER}:${GRAFANA_ADMIN_PASS}" \
      -H "Content-Type: application/json" \
      -X "${method}" "${GRAFANA_URL}${path}" \
      -d "${data}" -w $'\n%{http_code}')"
  else
    response="$(curl -sS -u "${GRAFANA_ADMIN_USER}:${GRAFANA_ADMIN_PASS}" \
      -X "${method}" "${GRAFANA_URL}${path}" -w $'\n%{http_code}')"
  fi
  status="$(echo "${response}" | sed -n '$p')"
  body="$(echo "${response}" | sed '$d')"
  if [[ "${status}" -lt 200 || "${status}" -ge 300 ]]; then
    echo "Grafana API error ${status} ${method} ${path}" >&2
    echo "${body}" >&2
    return 1
  fi
  echo "${body}"
}

create_service_account_token() {
  local sa_id="$1"
  local token_name="$2"
  local response body status

  response="$(curl -sS -u "${GRAFANA_ADMIN_USER}:${GRAFANA_ADMIN_PASS}" \
    -H "Content-Type: application/json" \
    -X POST "${GRAFANA_URL}/api/serviceaccounts/${sa_id}/tokens" \
    -d "$(jq -nc --arg name "${token_name}" '{name:$name}')" \
    -w $'\n%{http_code}')"
  status="$(echo "${response}" | sed -n '$p')"
  body="$(echo "${response}" | sed '$d')"

  if [[ "${status}" -ge 200 && "${status}" -lt 300 ]]; then
    echo "${body}"
    return 0
  fi

  if [[ "${status}" -eq 400 ]] && echo "${body}" | jq -e '.messageId=="serviceaccounts.ErrTokenAlreadyExists"' >/dev/null 2>&1; then
    return 10
  fi

  echo "Grafana API error ${status} POST /api/serviceaccounts/${sa_id}/tokens" >&2
  echo "${body}" >&2
  return 1
}

echo "Checking Grafana connectivity at ${GRAFANA_URL}..."
wait_for_grafana
api GET "/api/health" >/dev/null

echo "Resolving service account '${SLO_GRAFANA_SERVICE_ACCOUNT}'..."
SA_ID="$(
  api GET "/api/serviceaccounts/search?query=${SLO_GRAFANA_SERVICE_ACCOUNT}" \
    | jq -r --arg name "${SLO_GRAFANA_SERVICE_ACCOUNT}" '.serviceAccounts[]? | select(.name==$name) | .id' \
    | head -n 1
)"

if [[ -z "${SA_ID}" ]]; then
  echo "Creating service account '${SLO_GRAFANA_SERVICE_ACCOUNT}'..."
  SA_ID="$(
    api POST "/api/serviceaccounts" \
      "$(jq -nc \
        --arg name "${SLO_GRAFANA_SERVICE_ACCOUNT}" \
        --arg role "${SLO_GRAFANA_SERVICE_ACCOUNT_ROLE}" \
        '{name:$name, role:$role}')" \
      | jq -r '.id'
  )"
fi

if [[ -z "${SA_ID}" || "${SA_ID}" == "null" ]]; then
  echo "Unable to resolve/create service account ID" >&2
  exit 1
fi

echo "Creating token '${SLO_GRAFANA_TOKEN_NAME}' for service account ${SA_ID}..."
token_response=""
token_name="${SLO_GRAFANA_TOKEN_NAME}"
if token_response="$(create_service_account_token "${SA_ID}" "${token_name}")"; then
  :
elif [[ $? -eq 10 ]]; then
  token_name="${SLO_GRAFANA_TOKEN_NAME}-$(date +%s)"
  echo "Token '${SLO_GRAFANA_TOKEN_NAME}' already exists; creating '${token_name}' instead..."
  token_response="$(create_service_account_token "${SA_ID}" "${token_name}")"
fi

TOKEN="$(echo "${token_response}" | jq -r '.key')"

if [[ -z "${TOKEN}" || "${TOKEN}" == "null" ]]; then
  echo "Grafana did not return a token key." >&2
  exit 1
fi

mkdir -p "$(dirname "${OUTPUT_FILE}")"
cat >"${OUTPUT_FILE}" <<EOF
SLO_GRAFANA_TOKEN=${TOKEN}
SLO_GRAFANA_FOLDER_UID=${SLO_GRAFANA_FOLDER_UID}
EOF

echo "Wrote ${OUTPUT_FILE}"
echo "Use with:"
echo "  docker compose --env-file ${OUTPUT_FILE} up -d --build"
