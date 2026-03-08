FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /out/slo-control-plane ./cmd/slo-control-plane

FROM alpine:3.22
WORKDIR /app
COPY --from=build /out/slo-control-plane /usr/local/bin/slo-control-plane
COPY migrations ./migrations
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/slo-control-plane"]
