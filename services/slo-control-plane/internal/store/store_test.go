package store

import (
	"database/sql"
	"testing"
)

func TestNullStringToString(t *testing.T) {
	if got := nullStringToString(sql.NullString{Valid: false}); got != "" {
		t.Fatalf("expected empty string for invalid null string, got %q", got)
	}
	if got := nullStringToString(sql.NullString{Valid: true, String: "desc"}); got != "desc" {
		t.Fatalf("expected desc, got %q", got)
	}
}
