package outbox

import "github.com/google/uuid"

func parseUUID(v string) (uuid.UUID, error) {
	return uuid.Parse(v)
}
