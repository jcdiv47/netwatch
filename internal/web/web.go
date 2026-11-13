// Package web serves the JSON API and the embedded UI.
package web

import (
	"embed"
	"encoding/json"
	"io/fs"
	"log/slog"
	"mime"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"netwatch/internal/collector"
	"netwatch/internal/conntrack"
	"netwatch/internal/flow"
	"netwatch/internal/resolver"
	"netwatch/internal/store"
	"netwatch/internal/tracker"
)

//go:embed static
var staticFS embed.FS

type Server struct {
	Store     *store.Store
	Tracker   *tracker.Tracker
	Collector *collector.Collector
	Resolver  *resolver.Resolver
	Conntrack *conntrack.Poller // may be nil
	Log       *slog.Logger
	Started   time.Time
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	sub, _ := fs.Sub(staticFS, "static")
	files := http.FileServer(http.FS(sub))
	mux.Handle("GET /", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache")
		files.ServeHTTP(w, r)
	}))
	mux.HandleFunc("GET /api/status", s.status)
	mux.HandleFunc("GET /api/devices", s.devices)
	mux.HandleFunc("GET /api/device", s.device)
	mux.HandleFunc("POST /api/device/name", s.setName)
	mux.HandleFunc("GET /api/domains", s.domains)
	mux.HandleFunc("GET /api/domain", s.domain)
	mux.HandleFunc("GET /api/live", s.live)
	return securityHeaders(mux)
}

func securityHeaders(h http.Handler) http.Handler {
	_ = mime.AddExtensionType(".js", "text/javascript")
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:")
		w.Header().Set("Referrer-Policy", "no-referrer")
		h.ServeHTTP(w, r)
	})
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	enc := json.NewEncoder(w)
	_ = enc.Encode(v)
}

func (s *Server) fail(w http.ResponseWriter, err error, code int) {
	s.Log.Warn("api error", "err", err)
	http.Error(w, err.Error(), code)
}

// rangeParams: range=6h|24h|7d|30d|90d|365d. Returns fromHour (unix s),
// chart bucket seconds and the range start in ms.
func rangeParams(r *http.Request) (fromHour, bucket, fromMs int64, label string) {
	label = r.URL.Query().Get("range")
	d := 24 * time.Hour
	bucket = 3600
	switch label {
	case "6h":
		d = 6 * time.Hour
	case "7d":
		d = 7 * 24 * time.Hour
		bucket = 6 * 3600
	case "30d":
		d = 30 * 24 * time.Hour
		bucket = 86400
	case "90d":
		d = 90 * 24 * time.Hour
		bucket = 86400
	case "365d":
		d = 365 * 24 * time.Hour
		bucket = 7 * 86400
	default:
		label = "24h"
	}
	from := time.Now().Add(-d)
	// Rollups are hourly: include the hour containing the range start.
	fromHour = from.Unix() / 3600 * 3600
	return fromHour, bucket, from.UnixMilli(), label
}

func tzOffset() int64 {
	_, off := time.Now().Zone()
	return int64(off)
}

func (s *Server) status(w http.ResponseWriter, r *http.Request) {
	st, open := s.Tracker.GetStats()
	last, rerr, ipn, refreshes := s.Resolver.Status()
	out := map[string]any{
		"started":        s.Started,
		"stream":         s.Collector.Status(),
		"open":           open,
		"messages":       st.Messages,
		"events":         st.Events,
		"resets":         st.Resets,
		"orphan_updates": st.OrphanUpdates,
		"last_message":   st.LastMessage,
		"resolver":       map[string]any{"last_refresh": last, "error": errString(rerr), "known_ips": ipn, "refreshes": refreshes},
	}
	if s.Conntrack != nil {
		out["conntrack"] = s.Conntrack.Status()
	}
	writeJSON(w, out)
}

func errString(err error) string {
	if err == nil {
		return ""
	}
	return err.Error()
}

func (s *Server) devices(w http.ResponseWriter, r *http.Request) {
	fromHour, _, _, label := rangeParams(r)
	ds, err := s.Store.Devices(r.Context(), fromHour, r.URL.Query().Get("all") == "1")
	if err != nil {
		s.fail(w, err, 500)
		return
	}
	// Annotate open connection counts from memory.
	openBy := map[string]int{}
	for _, f := range s.openFlows() {
		openBy[f.DeviceKey]++
	}
	type row struct {
		store.Device
		Open int `json:"open"`
	}
	out := make([]row, 0, len(ds))
	for _, d := range ds {
		out = append(out, row{d, openBy[d.Key]})
	}
	writeJSON(w, map[string]any{"range": label, "devices": out})
}

func (s *Server) device(w http.ResponseWriter, r *http.Request) {
	key := r.URL.Query().Get("key")
	fromHour, bucket, fromMs, label := rangeParams(r)
	ctx := r.Context()
	d, err := s.Store.Device(ctx, key)
	if err != nil {
		s.fail(w, err, 500)
		return
	}
	if d == nil {
		http.Error(w, "unknown device", 404)
		return
	}
	top, err := s.Store.TopTargets(ctx, key, fromHour, 100)
	if err != nil {
		s.fail(w, err, 500)
		return
	}
	up, down, conns, ntargets, err := s.Store.DeviceTotals(ctx, key, fromHour)
	if err != nil {
		s.fail(w, err, 500)
		return
	}
	series, err := s.Store.Series(ctx, key, "", fromHour, bucket, tzOffset())
	if err != nil {
		s.fail(w, err, 500)
		return
	}
	recent, err := s.Store.RecentFlows(ctx, key, "", 100)
	if err != nil {
		s.fail(w, err, 500)
		return
	}
	newT, err := s.Store.NewTargets(ctx, key, fromMs, 100)
	if err != nil {
		s.fail(w, err, 500)
		return
	}
	var ips []store.IPSeen
	if d.Kind == "lan" {
		ips, _ = s.Store.DeviceIPs(ctx, key, 30)
	}
	var open []flow.Flow
	for _, f := range s.openFlows() {
		if f.DeviceKey == key {
			open = append(open, f)
		}
	}
	writeJSON(w, map[string]any{
		"range": label, "bucket": bucket, "device": d,
		"totals":      map[string]int64{"up": up, "down": down, "conns": conns, "targets": ntargets},
		"top_targets": top, "series": series, "recent_flows": recent, "new_targets": newT, "ips": ips,
		"open": len(open),
	})
}

func (s *Server) setName(w http.ResponseWriter, r *http.Request) {
	// Require JSON so a cross-site form post cannot change names (a
	// non-simple content type forces a CORS preflight, which we never allow).
	if !strings.HasPrefix(r.Header.Get("Content-Type"), "application/json") {
		http.Error(w, "content-type must be application/json", 415)
		return
	}
	var req struct {
		Key  string `json:"key"`
		Name string `json:"name"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req); err != nil || req.Key == "" {
		http.Error(w, "bad request", 400)
		return
	}
	name := strings.TrimSpace(req.Name)
	if len(name) > 100 {
		name = name[:100]
	}
	if err := s.Store.SetFriendlyName(r.Context(), req.Key, name); err != nil {
		s.fail(w, err, 500)
		return
	}
	writeJSON(w, map[string]string{"ok": "1"})
}

func (s *Server) domains(w http.ResponseWriter, r *http.Request) {
	fromHour, _, _, label := rangeParams(r)
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > 1000 {
		limit = 200
	}
	ts, err := s.Store.Targets(r.Context(), fromHour, r.URL.Query().Get("q"), limit)
	if err != nil {
		s.fail(w, err, 500)
		return
	}
	writeJSON(w, map[string]any{"range": label, "domains": ts})
}

func (s *Server) domain(w http.ResponseWriter, r *http.Request) {
	target := r.URL.Query().Get("target")
	fromHour, bucket, _, label := rangeParams(r)
	ctx := r.Context()
	devs, err := s.Store.TargetDevices(ctx, target, fromHour)
	if err != nil {
		s.fail(w, err, 500)
		return
	}
	series, err := s.Store.Series(ctx, "", target, fromHour, bucket, tzOffset())
	if err != nil {
		s.fail(w, err, 500)
		return
	}
	recent, err := s.Store.RecentFlows(ctx, "", target, 100)
	if err != nil {
		s.fail(w, err, 500)
		return
	}
	writeJSON(w, map[string]any{"range": label, "bucket": bucket, "target": target, "devices": devs, "series": series, "recent_flows": recent})
}

func (s *Server) openFlows() []flow.Flow {
	fs := s.Tracker.Open()
	if s.Conntrack != nil {
		fs = append(fs, s.Conntrack.Open()...)
	}
	return fs
}

func (s *Server) live(w http.ResponseWriter, r *http.Request) {
	names, err := s.Store.DeviceNames(r.Context())
	if err != nil {
		s.fail(w, err, 500)
		return
	}
	fs := s.openFlows()
	sort.Slice(fs, func(i, j int) bool {
		ri, rj := fs[i].RateUp+fs[i].RateDown, fs[j].RateUp+fs[j].RateDown
		if ri != rj {
			return ri > rj
		}
		return fs[i].Up+fs[i].Down > fs[j].Up+fs[j].Down
	})
	rows := make([]store.FlowRow, 0, len(fs))
	for _, f := range fs {
		name := names[f.DeviceKey]
		if name == "" {
			name = store.DisplayName(f.DeviceKey, store.KindOf(f.DeviceKey), "", "")
		}
		rows = append(rows, store.FlowRow{
			ID: f.ID, Source: f.Source, DeviceKey: f.DeviceKey, DeviceName: name,
			SrcIP: f.SrcIP, SrcPort: f.SrcPort, DstIP: f.DstIP, DstPort: f.DstPort, Domain: f.Domain, Target: f.Target(),
			Network: f.Network, Protocol: f.Protocol, Inbound: f.Inbound, Outbound: f.Outbound, Chain: f.Chain,
			CreatedAt: f.CreatedAt, Up: f.Up, Down: f.Down, RateUp: f.RateUp, RateDown: f.RateDown,
		})
	}
	writeJSON(w, map[string]any{"now": time.Now().UnixMilli(), "flows": rows})
}
