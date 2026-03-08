# SLO Control Plane OpenAPI

`slo-control-plane.openapi.yaml` is the source of truth for API contracts.

## Lint

Use any OpenAPI 3.1 linter in CI. Example:

`npx @redocly/cli lint api/openapi/slo-control-plane.openapi.yaml`

## Generate Go types/server interfaces

`go run github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen -generate types,chi-server,spec -package apiv1 api/openapi/slo-control-plane.openapi.yaml > services/slo-control-plane/internal/api/apiv1.gen.go`

## Generate TypeScript client types

`npx openapi-typescript api/openapi/slo-control-plane.openapi.yaml -o plugins/slo-app/src/api/generated/types.ts`
