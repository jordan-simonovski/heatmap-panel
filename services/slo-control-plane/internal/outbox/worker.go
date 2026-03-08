package outbox

import (
	"context"
	"log"
	"time"

	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"

	"github.com/jsimonovski/heatmap-panel/services/slo-control-plane/internal/burn"
	"github.com/jsimonovski/heatmap-panel/services/slo-control-plane/internal/store"
	"github.com/jsimonovski/heatmap-panel/services/slo-control-plane/internal/telemetry"
)

type Worker struct {
	store        *store.Store
	sink         *burn.Sink
	pollInterval time.Duration
	batchSize    int
}

func NewWorker(st *store.Store, sink *burn.Sink, pollInterval time.Duration, batchSize int) *Worker {
	return &Worker{
		store:        st,
		sink:         sink,
		pollInterval: pollInterval,
		batchSize:    batchSize,
	}
}

func (w *Worker) Run(ctx context.Context) {
	t := time.NewTicker(w.pollInterval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			w.flushOnce(ctx)
		}
	}
}

func (w *Worker) flushOnce(ctx context.Context) {
	tr := otel.Tracer("slo-control-plane/outbox")
	ctx, span := tr.Start(ctx, "outbox.flush_once", trace.WithSpanKind(trace.SpanKindInternal))
	defer span.End()
	span.SetAttributes(attribute.Int("outbox.batch_size", w.batchSize))

	events, err := w.store.ClaimPendingOutbox(ctx, w.batchSize)
	if err != nil {
		telemetry.RecordSpanError(span, err)
		log.Printf("outbox claim failed: %v", err)
		return
	}
	span.SetAttributes(attribute.Int("outbox.claimed_count", len(events)))
	delivered := 0
	retried := 0
	for _, ev := range events {
		b := burn.Event{
			ID:             ev.ID,
			ServiceID:      ev.AggregateID, // adjusted below if present in payload
			SLOID:          ev.AggregateID,
			EventType:      "burn_continued",
			Value:          0,
			Threshold:      0,
			ObservedAt:     time.Now().UTC(),
			Source:         "control-plane",
			IdempotencyKey: ev.IdempotencyKey,
		}
		if v, ok := ev.Payload["serviceId"].(string); ok {
			if parsed, err := parseUUID(v); err == nil {
				b.ServiceID = parsed
			}
		}
		if v, ok := ev.Payload["sloId"].(string); ok {
			if parsed, err := parseUUID(v); err == nil {
				b.SLOID = parsed
			}
		}
		if v, ok := ev.Payload["eventType"].(string); ok && v != "" {
			b.EventType = v
		}
		if v, ok := ev.Payload["value"].(float64); ok {
			b.Value = float32(v)
		}
		if v, ok := ev.Payload["threshold"].(float64); ok {
			b.Threshold = float32(v)
		}
		if v, ok := ev.Payload["source"].(string); ok && v != "" {
			b.Source = v
		}

		if err := w.sink.InsertEvent(ctx, b); err != nil {
			_ = w.store.MarkOutboxRetry(ctx, ev.ID, ev.RetryCount+1, err.Error())
			retried++
			continue
		}
		_ = w.store.InsertBurnEventView(ctx, store.BurnEvent{
			ID:             b.ID,
			ServiceID:      b.ServiceID,
			SLOID:          b.SLOID,
			EventType:      b.EventType,
			Value:          b.Value,
			Threshold:      b.Threshold,
			ObservedAt:     b.ObservedAt,
			Source:         b.Source,
			IdempotencyKey: b.IdempotencyKey,
		})
		_ = w.store.MarkOutboxDelivered(ctx, ev.ID)
		delivered++
	}
	span.SetAttributes(
		attribute.Int("outbox.delivered_count", delivered),
		attribute.Int("outbox.retried_count", retried),
	)
}
