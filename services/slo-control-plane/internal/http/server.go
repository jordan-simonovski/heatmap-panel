package httpapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"

	apiv1 "github.com/jsimonovski/heatmap-panel/services/slo-control-plane/internal/api"
	opensloparser "github.com/jsimonovski/heatmap-panel/services/slo-control-plane/internal/openslo"
	"github.com/jsimonovski/heatmap-panel/services/slo-control-plane/internal/store"
)

type Server struct {
	store *store.Store
}

func NewServer(st *store.Store) *Server {
	return &Server{store: st}
}

func (s *Server) GetHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, apiv1.HealthResponse{Status: apiv1.Ok})
}

func (s *Server) GetReady(w http.ResponseWriter, _ *http.Request) {
	if err := s.store.DB().Ping(); err != nil {
		writeProblem(w, http.StatusServiceUnavailable, "db_unavailable", "database unavailable")
		return
	}
	writeJSON(w, http.StatusOK, apiv1.ReadyResponse{Status: apiv1.Ready})
}

func (s *Server) ListTeams(w http.ResponseWriter, _ *http.Request, params apiv1.ListTeamsParams) {
	page, size := pagination(params.Page, params.PageSize)
	items, pg, err := s.store.ListTeams(context.Background(), page, size)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "list_teams_failed", err.Error())
		return
	}
	resp := apiv1.TeamListResponse{
		Items: make([]apiv1.Team, 0, len(items)),
		Page:  apiv1.Pagination{Page: pg.Page, PageSize: pg.PageSize, Total: pg.Total},
	}
	for _, t := range items {
		resp.Items = append(resp.Items, apiv1.Team{
			Id:        t.ID,
			Name:      t.Name,
			Slug:      t.Slug,
			CreatedAt: t.CreatedAt,
			UpdatedAt: t.UpdatedAt,
		})
	}
	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) CreateTeam(w http.ResponseWriter, r *http.Request) {
	var req apiv1.CreateTeamRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeProblem(w, http.StatusBadRequest, "invalid_body", "invalid JSON body")
		return
	}
	team, err := s.store.CreateTeam(context.Background(), uuid.New(), strings.TrimSpace(req.Name), strings.TrimSpace(req.Slug))
	if err != nil {
		writeProblem(w, statusFromError(err), "create_team_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, apiv1.Team{
		Id:        team.ID,
		Name:      team.Name,
		Slug:      team.Slug,
		CreatedAt: team.CreatedAt,
		UpdatedAt: team.UpdatedAt,
	})
}

func (s *Server) GetTeam(w http.ResponseWriter, _ *http.Request, teamId apiv1.TeamId) {
	team, err := s.store.GetTeam(context.Background(), uuid.UUID(teamId))
	if err != nil {
		writeProblem(w, statusFromError(err), "team_not_found", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, apiv1.Team{
		Id:        team.ID,
		Name:      team.Name,
		Slug:      team.Slug,
		CreatedAt: team.CreatedAt,
		UpdatedAt: team.UpdatedAt,
	})
}

func (s *Server) UpdateTeam(w http.ResponseWriter, r *http.Request, teamId apiv1.TeamId) {
	var req apiv1.UpdateTeamRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeProblem(w, http.StatusBadRequest, "invalid_body", "invalid JSON body")
		return
	}
	team, err := s.store.UpdateTeam(context.Background(), uuid.UUID(teamId), strings.TrimSpace(req.Name), strings.TrimSpace(req.Slug))
	if err != nil {
		writeProblem(w, statusFromError(err), "update_team_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, apiv1.Team{
		Id:        team.ID,
		Name:      team.Name,
		Slug:      team.Slug,
		CreatedAt: team.CreatedAt,
		UpdatedAt: team.UpdatedAt,
	})
}

func (s *Server) DeleteTeam(w http.ResponseWriter, _ *http.Request, teamId apiv1.TeamId) {
	if err := s.store.DeleteTeam(context.Background(), uuid.UUID(teamId)); err != nil {
		writeProblem(w, statusFromError(err), "delete_team_failed", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) ListServices(w http.ResponseWriter, _ *http.Request, params apiv1.ListServicesParams) {
	page, size := pagination(params.Page, params.PageSize)
	var owner *uuid.UUID
	if params.OwnerTeamId != nil {
		id := uuid.UUID(*params.OwnerTeamId)
		owner = &id
	}
	items, pg, err := s.store.ListServices(context.Background(), page, size, owner)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "list_services_failed", err.Error())
		return
	}
	resp := apiv1.ServiceListResponse{
		Items: make([]apiv1.Service, 0, len(items)),
		Page:  apiv1.Pagination{Page: pg.Page, PageSize: pg.PageSize, Total: pg.Total},
	}
	for _, srv := range items {
		md := srv.Metadata
		resp.Items = append(resp.Items, apiv1.Service{
			Id:          srv.ID,
			Name:        srv.Name,
			Slug:        srv.Slug,
			OwnerTeamId: srv.OwnerTeamID,
			Metadata:    &md,
			CreatedAt:   srv.CreatedAt,
			UpdatedAt:   srv.UpdatedAt,
		})
	}
	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) CreateService(w http.ResponseWriter, r *http.Request) {
	var req apiv1.CreateServiceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeProblem(w, http.StatusBadRequest, "invalid_body", "invalid JSON body")
		return
	}
	metadata := map[string]any{}
	if req.Metadata != nil {
		metadata = *req.Metadata
	}
	srv, err := s.store.CreateService(context.Background(), uuid.New(), strings.TrimSpace(req.Name), strings.TrimSpace(req.Slug), uuid.UUID(req.OwnerTeamId), metadata)
	if err != nil {
		writeProblem(w, statusFromError(err), "create_service_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, serviceToAPI(srv))
}

func (s *Server) GetService(w http.ResponseWriter, _ *http.Request, serviceId apiv1.ServiceId) {
	srv, err := s.store.GetService(context.Background(), uuid.UUID(serviceId))
	if err != nil {
		writeProblem(w, statusFromError(err), "service_not_found", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, serviceToAPI(srv))
}

func (s *Server) UpdateService(w http.ResponseWriter, r *http.Request, serviceId apiv1.ServiceId) {
	var req apiv1.UpdateServiceRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeProblem(w, http.StatusBadRequest, "invalid_body", "invalid JSON body")
		return
	}
	metadata := map[string]any{}
	if req.Metadata != nil {
		metadata = *req.Metadata
	}
	srv, err := s.store.UpdateService(context.Background(), uuid.UUID(serviceId), strings.TrimSpace(req.Name), strings.TrimSpace(req.Slug), uuid.UUID(req.OwnerTeamId), metadata)
	if err != nil {
		writeProblem(w, statusFromError(err), "update_service_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, serviceToAPI(srv))
}

func (s *Server) DeleteService(w http.ResponseWriter, _ *http.Request, serviceId apiv1.ServiceId) {
	if err := s.store.DeleteService(context.Background(), uuid.UUID(serviceId)); err != nil {
		writeProblem(w, statusFromError(err), "delete_service_failed", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) ListSLOs(w http.ResponseWriter, _ *http.Request, params apiv1.ListSLOsParams) {
	page, size := pagination(params.Page, params.PageSize)
	var serviceID *uuid.UUID
	if params.ServiceId != nil {
		id := uuid.UUID(*params.ServiceId)
		serviceID = &id
	}
	items, pg, err := s.store.ListSLOs(context.Background(), page, size, serviceID)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "list_slos_failed", err.Error())
		return
	}
	resp := apiv1.SLOListResponse{
		Items: make([]apiv1.SLO, 0, len(items)),
		Page:  apiv1.Pagination{Page: pg.Page, PageSize: pg.PageSize, Total: pg.Total},
	}
	for _, slo := range items {
		resp.Items = append(resp.Items, sloToAPI(slo))
	}
	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) CreateSLO(w http.ResponseWriter, r *http.Request, _ apiv1.CreateSLOParams) {
	var req apiv1.CreateSLORequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeProblem(w, http.StatusBadRequest, "invalid_body", "invalid JSON body")
		return
	}
	bundle, err := opensloparser.ParseBundle(req.Openslo)
	if err != nil {
		writeProblem(w, http.StatusBadRequest, "invalid_openslo", err.Error())
		return
	}
	runtimeMap := opensloparser.RuntimeToMap(bundle.Runtime)
	slo := store.SLO{
		ID:             uuid.New(),
		ServiceID:      uuid.UUID(req.ServiceId),
		Name:           bundle.Runtime.Name,
		Description:    bundle.Runtime.Description,
		Target:         bundle.Runtime.Target,
		WindowMinutes:  bundle.Runtime.WindowMinutes,
		OpenSLO:        req.Openslo,
		Canonical:      runtimeMap,
		DatasourceType: bundle.Runtime.DatasourceType,
		DatasourceUID:  bundle.Runtime.DatasourceUID,
	}
	ctx := context.Background()
	tx, err := s.store.BeginTx(ctx)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "tx_begin_failed", err.Error())
		return
	}
	defer tx.Rollback()
	created, err := s.store.CreateSLO(ctx, tx, slo)
	if err != nil {
		writeProblem(w, statusFromError(err), "create_slo_failed", err.Error())
		return
	}
	if err := s.store.ReplaceSLOOpenSLOObjectsTx(ctx, tx, created.ID, toStoreObjects(bundle.Objects)); err != nil {
		writeProblem(w, statusFromError(err), "create_slo_failed", err.Error())
		return
	}
	if err := tx.Commit(); err != nil {
		writeProblem(w, http.StatusInternalServerError, "tx_commit_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusCreated, sloToAPI(created))
}

func (s *Server) GetSLO(w http.ResponseWriter, _ *http.Request, sloId apiv1.SloId) {
	slo, err := s.store.GetSLO(context.Background(), uuid.UUID(sloId))
	if err != nil {
		writeProblem(w, statusFromError(err), "slo_not_found", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, sloToAPI(slo))
}

func (s *Server) UpdateSLO(w http.ResponseWriter, r *http.Request, sloId apiv1.SloId, _ apiv1.UpdateSLOParams) {
	var req apiv1.UpdateSLORequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeProblem(w, http.StatusBadRequest, "invalid_body", "invalid JSON body")
		return
	}
	bundle, err := opensloparser.ParseBundle(req.Openslo)
	if err != nil {
		writeProblem(w, http.StatusBadRequest, "invalid_openslo", err.Error())
		return
	}
	ctx := context.Background()
	tx, err := s.store.BeginTx(ctx)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "tx_begin_failed", err.Error())
		return
	}
	defer tx.Rollback()
	current, err := s.store.GetSLO(ctx, uuid.UUID(sloId))
	if err != nil {
		writeProblem(w, statusFromError(err), "slo_not_found", err.Error())
		return
	}
	current.Name = bundle.Runtime.Name
	current.Description = bundle.Runtime.Description
	current.Target = bundle.Runtime.Target
	current.WindowMinutes = bundle.Runtime.WindowMinutes
	current.OpenSLO = req.Openslo
	current.Canonical = opensloparser.RuntimeToMap(bundle.Runtime)
	current.DatasourceType = bundle.Runtime.DatasourceType
	current.DatasourceUID = bundle.Runtime.DatasourceUID
	updated, err := s.store.UpdateSLO(ctx, tx, current)
	if err != nil {
		writeProblem(w, statusFromError(err), "update_slo_failed", err.Error())
		return
	}
	if err := s.store.ReplaceSLOOpenSLOObjectsTx(ctx, tx, updated.ID, toStoreObjects(bundle.Objects)); err != nil {
		writeProblem(w, statusFromError(err), "update_slo_failed", err.Error())
		return
	}
	if err := tx.Commit(); err != nil {
		writeProblem(w, http.StatusInternalServerError, "tx_commit_failed", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, sloToAPI(updated))
}

func (s *Server) DeleteSLO(w http.ResponseWriter, _ *http.Request, sloId apiv1.SloId) {
	if err := s.store.DeleteSLO(context.Background(), uuid.UUID(sloId)); err != nil {
		writeProblem(w, statusFromError(err), "delete_slo_failed", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) GetSLOAlertStatus(w http.ResponseWriter, _ *http.Request, sloId apiv1.SloId) {
	states, err := s.store.ListAlertStatesBySLO(context.Background(), uuid.UUID(sloId))
	if err != nil {
		writeProblem(w, statusFromError(err), "get_slo_alert_status_failed", err.Error())
		return
	}
	resp := apiv1.AlertStateListResponse{
		Items: make([]apiv1.AlertState, 0, len(states)),
	}
	for _, st := range states {
		kind := apiv1.Burn
		if st.AlertKind == store.AlertKindBreach {
			kind = apiv1.Breach
		}
		var lastErr *string
		if st.LastError != "" {
			lastErr = &st.LastError
		}
		var lastReconciledAt *time.Time
		if st.LastReconciledAt.Valid {
			tm := st.LastReconciledAt.Time
			lastReconciledAt = &tm
		}
		resp.Items = append(resp.Items, apiv1.AlertState{
			SloId:               st.SLOID,
			AlertKind:           kind,
			GrafanaRuleUid:      st.GrafanaRuleUID,
			GrafanaNamespaceUid: st.GrafanaNamespaceUID,
			GrafanaRuleGroup:    st.GrafanaRuleGroup,
			LastAppliedSpecHash: st.LastAppliedSpecHash,
			Status:              st.Status,
			LastError:           lastErr,
			LastReconciledAt:    lastReconciledAt,
		})
	}
	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) ListBurnEvents(w http.ResponseWriter, _ *http.Request, params apiv1.ListBurnEventsParams) {
	page, size := pagination(params.Page, params.PageSize)
	var serviceID *uuid.UUID
	if params.ServiceId != nil {
		id := uuid.UUID(*params.ServiceId)
		serviceID = &id
	}
	var sloID *uuid.UUID
	if params.SloId != nil {
		id := uuid.UUID(*params.SloId)
		sloID = &id
	}
	items, pg, err := s.store.ListBurnEvents(context.Background(), page, size, serviceID, sloID)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "list_burn_events_failed", err.Error())
		return
	}
	resp := apiv1.BurnEventListResponse{
		Items: make([]apiv1.BurnEvent, 0, len(items)),
		Page:  apiv1.Pagination{Page: pg.Page, PageSize: pg.PageSize, Total: pg.Total},
	}
	for _, ev := range items {
		resp.Items = append(resp.Items, apiv1.BurnEvent{
			Id:             ev.ID,
			ServiceId:      ev.ServiceID,
			SloId:          ev.SLOID,
			EventType:      apiv1.BurnEventEventType(ev.EventType),
			Value:          ev.Value,
			Threshold:      ev.Threshold,
			ObservedAt:     ev.ObservedAt,
			Source:         ev.Source,
			IdempotencyKey: ev.IdempotencyKey,
		})
	}
	writeJSON(w, http.StatusOK, resp)
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeProblem(w http.ResponseWriter, status int, code, detail string) {
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(apiv1.Problem{
		Type:   "https://heatmap.local/problems/" + code,
		Title:  http.StatusText(status),
		Status: status,
		Code:   code,
		Detail: detail,
	})
}

func pagination(page, pageSize *int) (int, int) {
	p := 1
	sz := 50
	if page != nil && *page > 0 {
		p = *page
	}
	if pageSize != nil && *pageSize > 0 {
		sz = *pageSize
	}
	if sz > 200 {
		sz = 200
	}
	return p, sz
}

func statusFromError(err error) int {
	if err == sql.ErrNoRows {
		return http.StatusNotFound
	}
	return http.StatusBadRequest
}

func serviceToAPI(srv store.Service) apiv1.Service {
	md := srv.Metadata
	return apiv1.Service{
		Id:          srv.ID,
		Name:        srv.Name,
		Slug:        srv.Slug,
		OwnerTeamId: srv.OwnerTeamID,
		Metadata:    &md,
		CreatedAt:   srv.CreatedAt,
		UpdatedAt:   srv.UpdatedAt,
	}
}

func sloToAPI(s store.SLO) apiv1.SLO {
	runtime := opensloparser.MapToRuntime(s.Canonical)
	var dsType apiv1.SLORuntimeDatasourceType
	if runtime.DatasourceType == "prometheus" {
		dsType = apiv1.Prometheus
	} else {
		dsType = apiv1.Clickhouse
	}
	var desc *string
	if runtime.Description != "" {
		desc = &runtime.Description
	}
	var ux *string
	if runtime.UserExperience != "" {
		ux = &runtime.UserExperience
	}
	return apiv1.SLO{
		Id:             s.ID,
		ServiceId:      s.ServiceID,
		Openslo:        s.OpenSLO,
		Runtime: apiv1.SLORuntime{
			Name:           runtime.Name,
			Description:    desc,
			UserExperience: ux,
			Target:         runtime.Target,
			WindowMinutes:  runtime.WindowMinutes,
			Route:          runtime.Route,
			Type:           apiv1.SLORuntimeType(runtime.Type),
			Threshold:      runtime.Threshold,
			DatasourceType: dsType,
			DatasourceUid:  runtime.DatasourceUID,
		},
		CreatedAt:      s.CreatedAt,
		UpdatedAt:      s.UpdatedAt,
	}
}

func toStoreObjects(objs []opensloparser.Object) []store.OpenSLOObject {
	out := make([]store.OpenSLOObject, 0, len(objs))
	for _, obj := range objs {
		out = append(out, store.OpenSLOObject{
			Kind: obj.Kind,
			Name: obj.Name,
			JSON: obj.JSON,
		})
	}
	return out
}
