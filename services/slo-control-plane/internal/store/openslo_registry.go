package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"
)

type OpenSLOObject struct {
	Kind string
	Name string
	JSON []byte
}

func (s *Store) ReplaceSLOOpenSLOObjectsTx(ctx context.Context, tx *sql.Tx, sloID uuid.UUID, objects []OpenSLOObject) error {
	if _, err := tx.ExecContext(ctx, `DELETE FROM slo_openslo_objects WHERE slo_id = $1`, sloID); err != nil {
		return err
	}
	for _, obj := range objects {
		jsonBlob := obj.JSON
		if len(jsonBlob) == 0 {
			jsonBlob = []byte("{}")
		}
		if !json.Valid(jsonBlob) {
			return fmt.Errorf("invalid openslo object json for %s/%s", obj.Kind, obj.Name)
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO slo_openslo_objects (id, slo_id, object_kind, object_name, object_json)
			VALUES ($1,$2,$3,$4,$5::jsonb)
		`, uuid.New(), sloID, obj.Kind, obj.Name, string(jsonBlob)); err != nil {
			return err
		}
	}
	return nil
}
