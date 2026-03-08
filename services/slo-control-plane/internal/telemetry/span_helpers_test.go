package telemetry

import (
	"context"
	"testing"

	"go.opentelemetry.io/otel/attribute"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
)

func TestSetPayloadAttributesTruncatesAndHashes(t *testing.T) {
	recorder := tracetest.NewSpanRecorder()
	tp := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(recorder))
	tr := tp.Tracer("test")
	_, span := tr.Start(context.Background(), "root")

	payload := ""
	for i := 0; i < MaxPayloadAttributeBytes+50; i++ {
		payload += "a"
	}
	SetPayloadAttributes(span, "slo.openslo", payload)
	span.End()

	spans := recorder.Ended()
	if len(spans) != 1 {
		t.Fatalf("expected 1 span, got %d", len(spans))
	}
	attrs := spans[0].Attributes()
	get := func(key string) (attribute.Value, bool) {
		for _, kv := range attrs {
			if string(kv.Key) == key {
				return kv.Value, true
			}
		}
		return attribute.Value{}, false
	}
	v, ok := get("slo.openslo.raw_truncated")
	if !ok || !v.AsBool() {
		t.Fatalf("expected raw_truncated=true")
	}
	v, ok = get("slo.openslo.raw_bytes")
	if !ok || int(v.AsInt64()) != len(payload) {
		t.Fatalf("unexpected raw_bytes: %+v", v)
	}
	v, ok = get("slo.openslo.raw")
	if !ok || len(v.AsString()) != MaxPayloadAttributeBytes {
		t.Fatalf("unexpected raw length: %d", len(v.AsString()))
	}
	if _, ok := get("slo.openslo.raw_sha256"); !ok {
		t.Fatalf("expected raw_sha256")
	}
}
