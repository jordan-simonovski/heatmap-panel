package telemetry

import (
	"crypto/sha256"
	"encoding/hex"

	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
)

const MaxPayloadAttributeBytes = 8192

func SetPayloadAttributes(span trace.Span, prefix, payload string) {
	if payload == "" {
		return
	}
	truncated := false
	attrValue := payload
	if len(payload) > MaxPayloadAttributeBytes {
		truncated = true
		attrValue = payload[:MaxPayloadAttributeBytes]
	}
	sum := sha256.Sum256([]byte(payload))
	span.SetAttributes(
		attribute.String(prefix+".raw", attrValue),
		attribute.Bool(prefix+".raw_truncated", truncated),
		attribute.Int(prefix+".raw_bytes", len(payload)),
		attribute.String(prefix+".raw_sha256", hex.EncodeToString(sum[:])),
	)
}

func SetIfNotEmpty(span trace.Span, key, value string) {
	if value == "" {
		return
	}
	span.SetAttributes(attribute.String(key, value))
}

func RecordSpanError(span trace.Span, err error) {
	if err == nil {
		return
	}
	span.RecordError(err)
	span.SetStatus(codes.Error, err.Error())
}
