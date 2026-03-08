#!/usr/bin/env bash
set -euo pipefail

API_BASE_URL="${API_BASE_URL:-http://localhost:8080}"
API_V1="${API_BASE_URL}/v1"
STATE_FILE="${STATE_FILE:-/tmp/slo-control-plane-demo-state.json}"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_cmd curl
require_cmd jq

usage() {
  cat <<'EOF'
Usage:
  crud-demo.sh seed
  crud-demo.sh full-crud

  crud-demo.sh team create <name> <slug>
  crud-demo.sh team list
  crud-demo.sh team get <team_id>
  crud-demo.sh team update <team_id> <name> <slug>
  crud-demo.sh team delete <team_id>

  crud-demo.sh service create <name> <slug> <owner_team_id> [metadata_json]
  crud-demo.sh service list
  crud-demo.sh service get <service_id>
  crud-demo.sh service update <service_id> <name> <slug> <owner_team_id> [metadata_json]
  crud-demo.sh service delete <service_id>

  crud-demo.sh slo create <service_id> <name> <target> <window_minutes> <datasource_uid> <route> <latency|error_rate> <threshold>
  crud-demo.sh slo list
  crud-demo.sh slo get <slo_id>
  crud-demo.sh slo update <slo_id> <name> <target> <window_minutes> <datasource_uid> <route> <latency|error_rate> <threshold>
  crud-demo.sh slo delete <slo_id>

  crud-demo.sh burn list

Environment:
  API_BASE_URL  (default: http://localhost:8080)
  STATE_FILE    (default: /tmp/slo-control-plane-demo-state.json)
EOF
}

request() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  local url="${API_BASE_URL}${path}"
  local response http_code payload

  if [[ -n "${body}" ]]; then
    response="$(curl -sS -X "${method}" -H 'Content-Type: application/json' -d "${body}" "${url}" -w $'\n%{http_code}')"
  else
    response="$(curl -sS -X "${method}" "${url}" -w $'\n%{http_code}')"
  fi

  http_code="$(echo "${response}" | tail -n 1)"
  payload="$(echo "${response}" | sed '$d')"

  if [[ "${http_code}" -lt 200 || "${http_code}" -gt 299 ]]; then
    echo "HTTP ${http_code} ${method} ${path}" >&2
    echo "${payload}" | jq . >&2 || echo "${payload}" >&2
    exit 1
  fi

  if [[ -n "${payload}" ]]; then
    echo "${payload}" | jq .
  fi
}

openslo_yaml() {
  local name="$1"
  local route="$2"
  local target="$3"
  local type="$4"
  local threshold="$5"

  cat <<EOF
apiVersion: openslo/v1
kind: SLO
metadata:
  name: ${name}
spec:
  service: generated-service
  objective:
    target: ${target}
  indicator:
    route: ${route}
    type: ${type}
    threshold: ${threshold}
EOF
}

slo_payload_create() {
  local service_id="$1"
  local name="$2"
  local target="$3"
  local window="$4"
  local ds_uid="$5"
  local route="$6"
  local type="$7"
  local threshold="$8"

  local openslo canonical
  openslo="$(openslo_yaml "${name}" "${route}" "${target}" "${type}" "${threshold}")"
  canonical="$(jq -nc \
    --arg route "${route}" \
    --arg type "${type}" \
    --argjson threshold "${threshold}" \
    'if $type == "latency" then {route:$route, type:$type, thresholdMs:$threshold} else {route:$route, type:$type, thresholdRate:$threshold} end')"

  jq -nc \
    --arg serviceId "${service_id}" \
    --arg name "${name}" \
    --argjson target "${target}" \
    --argjson windowMinutes "${window}" \
    --arg openslo "${openslo}" \
    --arg datasourceUid "${ds_uid}" \
    --argjson canonical "${canonical}" \
    '{
      serviceId: $serviceId,
      name: $name,
      target: $target,
      windowMinutes: $windowMinutes,
      openslo: $openslo,
      datasourceType: "clickhouse",
      datasourceUid: $datasourceUid,
      canonical: $canonical
    }'
}

slo_payload_update() {
  local name="$1"
  local target="$2"
  local window="$3"
  local ds_uid="$4"
  local route="$5"
  local type="$6"
  local threshold="$7"
  local openslo
  openslo="$(openslo_yaml "${name}" "${route}" "${target}" "${type}" "${threshold}")"

  jq -nc \
    --arg name "${name}" \
    --argjson target "${target}" \
    --argjson windowMinutes "${window}" \
    --arg openslo "${openslo}" \
    --arg datasourceUid "${ds_uid}" \
    '{
      name: $name,
      target: $target,
      windowMinutes: $windowMinutes,
      openslo: $openslo,
      datasourceType: "clickhouse",
      datasourceUid: $datasourceUid
    }'
}

team_cmd() {
  local action="${1:-}"
  case "${action}" in
    create)
      local name="$2" slug="$3"
      request POST "/v1/teams" "$(jq -nc --arg name "${name}" --arg slug "${slug}" '{name:$name,slug:$slug}')"
      ;;
    list) request GET "/v1/teams" ;;
    get) request GET "/v1/teams/$2" ;;
    update)
      local id="$2" name="$3" slug="$4"
      request PUT "/v1/teams/${id}" "$(jq -nc --arg name "${name}" --arg slug "${slug}" '{name:$name,slug:$slug}')"
      ;;
    delete) request DELETE "/v1/teams/$2" ;;
    *) usage; exit 1 ;;
  esac
}

service_cmd() {
  local action="${1:-}"
  case "${action}" in
    create)
      local name="$2" slug="$3" owner_team_id="$4" metadata="${5:-{}}"
      request POST "/v1/services" "$(jq -nc --arg name "${name}" --arg slug "${slug}" --arg ownerTeamId "${owner_team_id}" --argjson metadata "${metadata}" '{name:$name,slug:$slug,ownerTeamId:$ownerTeamId,metadata:$metadata}')"
      ;;
    list) request GET "/v1/services" ;;
    get) request GET "/v1/services/$2" ;;
    update)
      local id="$2" name="$3" slug="$4" owner_team_id="$5" metadata="${6:-{}}"
      request PUT "/v1/services/${id}" "$(jq -nc --arg name "${name}" --arg slug "${slug}" --arg ownerTeamId "${owner_team_id}" --argjson metadata "${metadata}" '{name:$name,slug:$slug,ownerTeamId:$ownerTeamId,metadata:$metadata}')"
      ;;
    delete) request DELETE "/v1/services/$2" ;;
    *) usage; exit 1 ;;
  esac
}

slo_cmd() {
  local action="${1:-}"
  case "${action}" in
    create)
      local service_id="$2" name="$3" target="$4" window="$5" ds_uid="$6" route="$7" type="$8" threshold="$9"
      request POST "/v1/slos" "$(slo_payload_create "${service_id}" "${name}" "${target}" "${window}" "${ds_uid}" "${route}" "${type}" "${threshold}")"
      ;;
    list) request GET "/v1/slos" ;;
    get) request GET "/v1/slos/$2" ;;
    update)
      local id="$2" name="$3" target="$4" window="$5" ds_uid="$6" route="$7" type="$8" threshold="$9"
      request PUT "/v1/slos/${id}" "$(slo_payload_update "${name}" "${target}" "${window}" "${ds_uid}" "${route}" "${type}" "${threshold}")"
      ;;
    delete) request DELETE "/v1/slos/$2" ;;
    *) usage; exit 1 ;;
  esac
}

burn_cmd() {
  local action="${1:-}"
  case "${action}" in
    list) request GET "/v1/burn-events" ;;
    *) usage; exit 1 ;;
  esac
}

seed_examples() {
  echo "Seeding trace-generator-based examples into ${API_V1}..."

  local team service slo1 slo2 slo3 slo4
  team="$(team_cmd create "platform-team" "platform-team")"
  local team_id
  team_id="$(echo "${team}" | jq -r '.id')"

  service="$(service_cmd create "api-gateway" "api-gateway" "${team_id}" '{"source":"trace-generator","owner":"platform"}')"
  local service_id
  service_id="$(echo "${service}" | jq -r '.id')"

  slo1="$(slo_cmd create "${service_id}" "checkout-latency" "0.99" "30" "clickhouse" "/cart/checkout" "latency" "500")"
  slo2="$(slo_cmd create "${service_id}" "orders-error-rate" "0.99" "30" "clickhouse" "/api/orders" "error_rate" "0.02")"
  slo3="$(slo_cmd create "${service_id}" "search-error-rate" "0.99" "30" "clickhouse" "/api/search" "error_rate" "0.01")"
  slo4="$(slo_cmd create "${service_id}" "auth-latency" "0.995" "30" "clickhouse" "/api/auth" "latency" "300")"

  jq -nc \
    --arg teamId "${team_id}" \
    --arg serviceId "${service_id}" \
    --arg slo1Id "$(echo "${slo1}" | jq -r '.id')" \
    --arg slo2Id "$(echo "${slo2}" | jq -r '.id')" \
    --arg slo3Id "$(echo "${slo3}" | jq -r '.id')" \
    --arg slo4Id "$(echo "${slo4}" | jq -r '.id')" \
    '{
      teamId: $teamId,
      serviceId: $serviceId,
      sloIds: [$slo1Id, $slo2Id, $slo3Id, $slo4Id]
    }' > "${STATE_FILE}"

  echo "Seed complete."
  echo "Saved IDs to ${STATE_FILE}"
  cat "${STATE_FILE}" | jq .
}

full_crud_flow() {
  seed_examples

  local team_id service_id first_slo
  team_id="$(jq -r '.teamId' "${STATE_FILE}")"
  service_id="$(jq -r '.serviceId' "${STATE_FILE}")"
  first_slo="$(jq -r '.sloIds[0]' "${STATE_FILE}")"

  echo "Running LIST..."
  team_cmd list >/dev/null
  service_cmd list >/dev/null
  slo_cmd list >/dev/null
  burn_cmd list >/dev/null || true

  echo "Running GET..."
  team_cmd get "${team_id}" >/dev/null
  service_cmd get "${service_id}" >/dev/null
  slo_cmd get "${first_slo}" >/dev/null

  echo "Running UPDATE..."
  team_cmd update "${team_id}" "platform-team-updated" "platform-team-updated" >/dev/null
  service_cmd update "${service_id}" "api-gateway-updated" "api-gateway-updated" "${team_id}" '{"source":"trace-generator","phase":"updated"}' >/dev/null
  slo_cmd update "${first_slo}" "checkout-latency-updated" "0.995" "45" "clickhouse" "/cart/checkout" "latency" "450" >/dev/null

  echo "Running DELETE..."
  while IFS= read -r slo_id; do
    slo_cmd delete "${slo_id}" >/dev/null
  done < <(jq -r '.sloIds[]' "${STATE_FILE}")
  service_cmd delete "${service_id}" >/dev/null
  team_cmd delete "${team_id}" >/dev/null

  echo "Full CRUD flow completed successfully."
}

main() {
  if [[ $# -lt 1 ]]; then
    usage
    exit 1
  fi

  case "$1" in
    seed) seed_examples ;;
    full-crud) full_crud_flow ;;
    team) shift; team_cmd "$@" ;;
    service) shift; service_cmd "$@" ;;
    slo) shift; slo_cmd "$@" ;;
    burn) shift; burn_cmd "$@" ;;
    *) usage; exit 1 ;;
  esac
}

main "$@"
