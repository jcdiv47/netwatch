package store

import (
	"context"
	"database/sql"
	"strings"
)

type Device struct {
	Key          string `json:"key"`
	Kind         string `json:"kind"`
	Name         string `json:"name"`
	Hostname     string `json:"hostname"`
	FriendlyName string `json:"friendly_name"`
	LastIP4      string `json:"last_ip4"`
	LastIP6      string `json:"last_ip6"`
	FirstSeen    int64  `json:"first_seen"`
	LastSeen     int64  `json:"last_seen"`
	Up           int64  `json:"up"`
	Down         int64  `json:"down"`
	Conns        int64  `json:"conns"`
	Targets      int64  `json:"targets,omitempty"`
}

// DisplayName picks the label shown for a device.
func DisplayName(key, kind, hostname, friendly string) string {
	if friendly != "" {
		return friendly
	}
	switch kind {
	case "router":
		if hostname != "" && hostname != "router" {
			return "Router (" + hostname + ")"
		}
		return "Router"
	case "remote":
		rest := strings.TrimPrefix(key, "inbound:")
		return "Remote via " + rest
	case "unknown":
		return "Unknown " + strings.TrimPrefix(key, "ip:")
	}
	if hostname != "" {
		return hostname
	}
	return key
}

func (d *Device) fill() { d.Name = DisplayName(d.Key, d.Kind, d.Hostname, d.FriendlyName) }

const deviceCols = `d.key, d.kind, d.hostname, d.friendly_name, d.last_ip4, d.last_ip6, d.first_seen, d.last_seen`

// Devices returns devices with traffic totals since fromHour (unix s). With
// all=false only devices with traffic in the range are returned.
func (s *Store) Devices(ctx context.Context, fromHour int64, all bool) ([]Device, error) {
	q := `SELECT ` + deviceCols + `, COALESCE(r.up,0), COALESCE(r.down,0), COALESCE(r.conns,0), COALESCE(r.targets,0)
		FROM devices d LEFT JOIN (
			SELECT device_key, SUM(up) up, SUM(down) down, SUM(conns) conns, COUNT(DISTINCT target) targets
			FROM rollup_hourly WHERE hour >= ? GROUP BY device_key) r ON r.device_key = d.key`
	if !all {
		q += ` WHERE r.device_key IS NOT NULL`
	}
	q += ` ORDER BY COALESCE(r.up,0)+COALESCE(r.down,0) DESC, d.last_seen DESC`
	rows, err := s.DB.QueryContext(ctx, q, fromHour)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Device
	for rows.Next() {
		var d Device
		if err := rows.Scan(&d.Key, &d.Kind, &d.Hostname, &d.FriendlyName, &d.LastIP4, &d.LastIP6, &d.FirstSeen, &d.LastSeen, &d.Up, &d.Down, &d.Conns, &d.Targets); err != nil {
			return nil, err
		}
		d.fill()
		out = append(out, d)
	}
	return out, rows.Err()
}

func (s *Store) Device(ctx context.Context, key string) (*Device, error) {
	var d Device
	err := s.DB.QueryRowContext(ctx, `SELECT `+deviceCols+` FROM devices d WHERE d.key = ?`, key).
		Scan(&d.Key, &d.Kind, &d.Hostname, &d.FriendlyName, &d.LastIP4, &d.LastIP6, &d.FirstSeen, &d.LastSeen)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	d.fill()
	return &d, nil
}

// DeviceNames returns key -> display name for all devices.
func (s *Store) DeviceNames(ctx context.Context) (map[string]string, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT key, kind, hostname, friendly_name FROM devices`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var k, kind, h, f string
		if err := rows.Scan(&k, &kind, &h, &f); err != nil {
			return nil, err
		}
		out[k] = DisplayName(k, kind, h, f)
	}
	return out, rows.Err()
}

type TargetStat struct {
	Target    string `json:"target"`
	Up        int64  `json:"up"`
	Down      int64  `json:"down"`
	Conns     int64  `json:"conns"`
	Devices   int64  `json:"devices,omitempty"`
	FirstSeen int64  `json:"first_seen,omitempty"`
	LastSeen  int64  `json:"last_seen,omitempty"`
}

func (s *Store) TopTargets(ctx context.Context, deviceKey string, fromHour int64, limit int) ([]TargetStat, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT target, SUM(up), SUM(down), SUM(conns) FROM rollup_hourly
		WHERE device_key = ? AND hour >= ? GROUP BY target ORDER BY SUM(up)+SUM(down) DESC LIMIT ?`, deviceKey, fromHour, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []TargetStat
	for rows.Next() {
		var t TargetStat
		if err := rows.Scan(&t.Target, &t.Up, &t.Down, &t.Conns); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// Targets lists targets across all devices, optionally filtered by a
// substring.
func (s *Store) Targets(ctx context.Context, fromHour int64, q string, limit int) ([]TargetStat, error) {
	args := []any{fromHour}
	where := ""
	if q != "" {
		where = ` AND target LIKE ? ESCAPE '\'`
		r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
		args = append(args, "%"+r.Replace(q)+"%")
	}
	args = append(args, limit)
	rows, err := s.DB.QueryContext(ctx, `SELECT target, SUM(up), SUM(down), SUM(conns), COUNT(DISTINCT device_key) FROM rollup_hourly
		WHERE hour >= ?`+where+` GROUP BY target ORDER BY SUM(up)+SUM(down) DESC LIMIT ?`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []TargetStat
	for rows.Next() {
		var t TargetStat
		if err := rows.Scan(&t.Target, &t.Up, &t.Down, &t.Conns, &t.Devices); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

type Point struct {
	T    int64 `json:"t"` // unix s, bucket start
	Up   int64 `json:"up"`
	Down int64 `json:"down"`
}

// Series returns traffic per bucket for a device or a target (one of them
// set). bucket is in seconds (multiple of 3600); tzOffset (seconds east of
// UTC) aligns day buckets to local midnight.
func (s *Store) Series(ctx context.Context, deviceKey, target string, fromHour, bucket, tzOffset int64) ([]Point, error) {
	col, val := "device_key", deviceKey
	if deviceKey == "" {
		col, val = "target", target
	}
	if bucket < 3600 {
		bucket = 3600
	}
	rows, err := s.DB.QueryContext(ctx, `SELECT ((hour + ?) / ?) * ? - ? AS b, SUM(up), SUM(down) FROM rollup_hourly
		WHERE `+col+` = ? AND hour >= ? GROUP BY b ORDER BY b`, tzOffset, bucket, bucket, tzOffset, val, fromHour)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Point
	for rows.Next() {
		var p Point
		if err := rows.Scan(&p.T, &p.Up, &p.Down); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

type FlowRow struct {
	ID          string  `json:"id"`
	Source      string  `json:"source"`
	DeviceKey   string  `json:"device_key"`
	DeviceName  string  `json:"device_name"`
	SrcIP       string  `json:"src_ip"`
	SrcPort     int     `json:"src_port"`
	DstIP       string  `json:"dst_ip"`
	DstPort     int     `json:"dst_port"`
	Domain      string  `json:"domain"`
	Target      string  `json:"target"`
	Network     string  `json:"network"`
	Protocol    string  `json:"protocol"`
	Inbound     string  `json:"inbound"`
	InboundType string  `json:"inbound_type"`
	Outbound    string  `json:"outbound"`
	Rule        string  `json:"rule"`
	Chain       string  `json:"chain"`
	User        string  `json:"user"`
	IPVersion   int     `json:"ip_version"`
	CreatedAt   int64   `json:"created_at"`
	ClosedAt    *int64  `json:"closed_at"`
	Up          int64   `json:"up"`
	Down        int64   `json:"down"`
	RateUp      float64 `json:"rate_up,omitempty"`
	RateDown    float64 `json:"rate_down,omitempty"`
}

const flowSelect = `SELECT f.conn_id, f.source, f.device_key, COALESCE(d.kind,''), COALESCE(d.hostname,''), COALESCE(d.friendly_name,''),
	f.src_ip, f.src_port, f.dst_ip, f.dst_port, f.domain, f.target, f.network, f.protocol, f.inbound, f.inbound_type,
	f.outbound, f.rule, f.chain, f.user, f.ip_version, f.created_at, f.closed_at, f.up, f.down
	FROM flows f LEFT JOIN devices d ON d.key = f.device_key `

func scanFlows(rows *sql.Rows) ([]FlowRow, error) {
	defer rows.Close()
	var out []FlowRow
	for rows.Next() {
		var r FlowRow
		var kind, host, fr string
		var closed sql.NullInt64
		if err := rows.Scan(&r.ID, &r.Source, &r.DeviceKey, &kind, &host, &fr, &r.SrcIP, &r.SrcPort, &r.DstIP, &r.DstPort,
			&r.Domain, &r.Target, &r.Network, &r.Protocol, &r.Inbound, &r.InboundType, &r.Outbound, &r.Rule, &r.Chain,
			&r.User, &r.IPVersion, &r.CreatedAt, &closed, &r.Up, &r.Down); err != nil {
			return nil, err
		}
		if kind == "" {
			kind = KindOf(r.DeviceKey)
		}
		r.DeviceName = DisplayName(r.DeviceKey, kind, host, fr)
		if closed.Valid {
			v := closed.Int64
			r.ClosedAt = &v
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// RecentFlows by device or target (one set).
func (s *Store) RecentFlows(ctx context.Context, deviceKey, target string, limit int) ([]FlowRow, error) {
	col, val := "f.device_key", deviceKey
	if deviceKey == "" {
		col, val = "f.target", target
	}
	rows, err := s.DB.QueryContext(ctx, flowSelect+`WHERE `+col+` = ? ORDER BY f.created_at DESC LIMIT ?`, val, limit)
	if err != nil {
		return nil, err
	}
	return scanFlows(rows)
}

// FlowFilter selects flows for the connections list.
type FlowFilter struct {
	Since   int64  // created_at >= Since (unix ms)
	State   string // "open", "closed", anything else: both
	Query   string // see flowQuery
	ByBytes bool   // largest first instead of newest first
	Limit   int
}

var likeEscaper = strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)

func like(v string) string { return "%" + likeEscaper.Replace(v) + "%" }

// flowQuery turns a search string into SQL conditions. Words are ANDed. A
// word of the form key:value tests one field; the keys are the ones the
// sing-box dashboard understands (network, inbound, inbound.type, source,
// destination, outbound) plus device, domain, target (exact), protocol, rule,
// user and port.
// Any other word matches the device, domain, addresses or outbound.
func flowQuery(q string) (conds []string, args []any) {
	const esc = ` ESCAPE '\'`
	anyOf := func(v string, cols ...string) {
		parts := make([]string, len(cols))
		for i, c := range cols {
			parts[i] = c + " LIKE ?" + esc
			args = append(args, like(v))
		}
		conds = append(conds, "("+strings.Join(parts, " OR ")+")")
	}
	plain := func(v string) {
		anyOf(v, "f.target", "f.dst_ip", "f.src_ip", "f.outbound", "f.chain", "f.device_key", "d.hostname", "d.friendly_name")
	}
	for _, tok := range strings.Fields(q) {
		key, val, ok := strings.Cut(tok, ":")
		if !ok || key == "" || val == "" {
			plain(tok)
			continue
		}
		switch strings.ToLower(key) {
		case "network":
			conds = append(conds, "f.network = ?")
			args = append(args, strings.ToLower(val))
		case "port":
			conds = append(conds, "CAST(f.dst_port AS TEXT) = ?")
			args = append(args, val)
		case "inbound":
			anyOf(val, "f.inbound")
		case "inbound.type":
			anyOf(val, "f.inbound_type")
		case "source":
			anyOf(val, "f.src_ip || ':' || f.src_port")
		case "destination":
			anyOf(val, "f.dst_ip || ':' || f.dst_port", "f.domain")
		case "outbound":
			anyOf(val, "f.outbound", "f.chain")
		case "device":
			anyOf(val, "f.device_key", "d.hostname", "d.friendly_name")
		case "domain":
			anyOf(val, "f.domain")
		case "target":
			conds = append(conds, "f.target = ?")
			args = append(args, val)
		case "protocol":
			anyOf(val, "f.protocol")
		case "rule":
			anyOf(val, "f.rule")
		case "user":
			anyOf(val, "f.user")
		default:
			plain(tok)
		}
	}
	return conds, args
}

// Flows lists recorded connections, newest (or largest) first. more reports
// whether the limit cut the list short.
func (s *Store) Flows(ctx context.Context, f FlowFilter) (out []FlowRow, more bool, err error) {
	conds, args := flowQuery(f.Query)
	conds = append([]string{"f.created_at >= ?"}, conds...)
	args = append([]any{f.Since}, args...)
	switch f.State {
	case "open":
		conds = append(conds, "f.closed_at IS NULL")
	case "closed":
		conds = append(conds, "f.closed_at IS NOT NULL")
	}
	order := "f.created_at DESC"
	if f.ByBytes {
		order = "f.up + f.down DESC, f.created_at DESC"
	}
	rows, err := s.DB.QueryContext(ctx, flowSelect+"WHERE "+strings.Join(conds, " AND ")+" ORDER BY "+order+" LIMIT ?",
		append(args, f.Limit+1)...)
	if err != nil {
		return nil, false, err
	}
	out, err = scanFlows(rows)
	if len(out) > f.Limit {
		out, more = out[:f.Limit], true
	}
	return out, more, err
}

// NewTargets returns targets a device first contacted at or after since (ms).
func (s *Store) NewTargets(ctx context.Context, deviceKey string, since int64, limit int) ([]TargetStat, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT target, first_seen, last_seen FROM device_targets
		WHERE device_key = ? AND first_seen >= ? ORDER BY first_seen DESC LIMIT ?`, deviceKey, since, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []TargetStat
	for rows.Next() {
		var t TargetStat
		if err := rows.Scan(&t.Target, &t.FirstSeen, &t.LastSeen); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

type TargetDevice struct {
	Device
	FirstSeen int64 `json:"target_first_seen"`
	LastSeen  int64 `json:"target_last_seen"`
}

// TargetDevices returns devices that contacted target since fromHour.
func (s *Store) TargetDevices(ctx context.Context, target string, fromHour int64) ([]TargetDevice, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT r.device_key, COALESCE(d.kind,''), COALESCE(d.hostname,''), COALESCE(d.friendly_name,''),
		SUM(r.up), SUM(r.down), SUM(r.conns), COALESCE(t.first_seen,0), COALESCE(t.last_seen,0)
		FROM rollup_hourly r
		LEFT JOIN devices d ON d.key = r.device_key
		LEFT JOIN device_targets t ON t.device_key = r.device_key AND t.target = r.target
		WHERE r.target = ? AND r.hour >= ?
		GROUP BY r.device_key ORDER BY SUM(r.up)+SUM(r.down) DESC`, target, fromHour)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []TargetDevice
	for rows.Next() {
		var t TargetDevice
		if err := rows.Scan(&t.Key, &t.Kind, &t.Hostname, &t.FriendlyName, &t.Up, &t.Down, &t.Conns, &t.FirstSeen, &t.LastSeen); err != nil {
			return nil, err
		}
		if t.Kind == "" {
			t.Kind = KindOf(t.Key)
		}
		t.fill()
		out = append(out, t)
	}
	return out, rows.Err()
}

type IPSeen struct {
	IP        string `json:"ip"`
	Src       string `json:"src"`
	FirstSeen int64  `json:"first_seen"`
	LastSeen  int64  `json:"last_seen"`
}

func (s *Store) DeviceIPs(ctx context.Context, mac string, limit int) ([]IPSeen, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT ip, src, first_seen, last_seen FROM ip_mac WHERE mac = ? ORDER BY last_seen DESC LIMIT ?`, mac, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []IPSeen
	for rows.Next() {
		var r IPSeen
		if err := rows.Scan(&r.IP, &r.Src, &r.FirstSeen, &r.LastSeen); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// DeviceTotals sums a device's traffic since fromHour.
func (s *Store) DeviceTotals(ctx context.Context, key string, fromHour int64) (up, down, conns, targets int64, err error) {
	err = s.DB.QueryRowContext(ctx, `SELECT COALESCE(SUM(up),0), COALESCE(SUM(down),0), COALESCE(SUM(conns),0), COUNT(DISTINCT target)
		FROM rollup_hourly WHERE device_key = ? AND hour >= ?`, key, fromHour).Scan(&up, &down, &conns, &targets)
	return
}

// Totals sums all traffic since fromHour.
type Totals struct {
	Up      int64 `json:"up"`
	Down    int64 `json:"down"`
	Conns   int64 `json:"conns"`
	Devices int64 `json:"devices"`
	Targets int64 `json:"targets"`
}

func (s *Store) Totals(ctx context.Context, fromHour int64) (Totals, error) {
	var t Totals
	err := s.DB.QueryRowContext(ctx, `SELECT COALESCE(SUM(up),0), COALESCE(SUM(down),0), COALESCE(SUM(conns),0),
		COUNT(DISTINCT device_key), COUNT(DISTINCT target) FROM rollup_hourly WHERE hour >= ?`, fromHour).
		Scan(&t.Up, &t.Down, &t.Conns, &t.Devices, &t.Targets)
	return t, err
}

// SeriesAll is Series across every device and target.
func (s *Store) SeriesAll(ctx context.Context, fromHour, bucket, tzOffset int64) ([]Point, error) {
	if bucket < 3600 {
		bucket = 3600
	}
	rows, err := s.DB.QueryContext(ctx, `SELECT ((hour + ?) / ?) * ? - ? AS b, SUM(up), SUM(down) FROM rollup_hourly
		WHERE hour >= ? GROUP BY b ORDER BY b`, tzOffset, bucket, bucket, tzOffset, fromHour)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Point
	for rows.Next() {
		var p Point
		if err := rows.Scan(&p.T, &p.Up, &p.Down); err != nil {
			return nil, err
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// SeriesByDevice returns, per device key, total bytes (up+down) per bucket
// keyed by bucket start. Used for the per-row sparklines.
func (s *Store) SeriesByDevice(ctx context.Context, fromHour, bucket, tzOffset int64) (map[string]map[int64]int64, error) {
	if bucket < 3600 {
		bucket = 3600
	}
	rows, err := s.DB.QueryContext(ctx, `SELECT device_key, ((hour + ?) / ?) * ? - ? AS b, SUM(up)+SUM(down) FROM rollup_hourly
		WHERE hour >= ? GROUP BY device_key, b`, tzOffset, bucket, bucket, tzOffset, fromHour)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]map[int64]int64{}
	for rows.Next() {
		var k string
		var b, v int64
		if err := rows.Scan(&k, &b, &v); err != nil {
			return nil, err
		}
		m := out[k]
		if m == nil {
			m = map[int64]int64{}
			out[k] = m
		}
		m[b] = v
	}
	return out, rows.Err()
}

// Link is traffic between one device and one target. An empty DeviceKey or
// Target stands for "everything else" (outside the requested top sets).
type Link struct {
	DeviceKey string `json:"device_key"`
	Target    string `json:"target"`
	Up        int64  `json:"up"`
	Down      int64  `json:"down"`
}

// Links aggregates traffic since fromHour into a devices x targets matrix,
// folding every device/target outside the given sets into "".
func (s *Store) Links(ctx context.Context, fromHour int64, devices, targets []string) ([]Link, error) {
	in := func(col string, vals []string, args *[]any) string {
		if len(vals) == 0 {
			return `''`
		}
		for _, v := range vals {
			*args = append(*args, v)
		}
		return `CASE WHEN ` + col + ` IN (?` + strings.Repeat(`,?`, len(vals)-1) + `) THEN ` + col + ` ELSE '' END`
	}
	var args []any
	d := in("device_key", devices, &args)
	t := in("target", targets, &args)
	args = append(args, fromHour)
	rows, err := s.DB.QueryContext(ctx, `SELECT `+d+` AS d, `+t+` AS t, SUM(up), SUM(down) FROM rollup_hourly
		WHERE hour >= ? GROUP BY d, t ORDER BY SUM(up)+SUM(down) DESC`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Link
	for rows.Next() {
		var l Link
		if err := rows.Scan(&l.DeviceKey, &l.Target, &l.Up, &l.Down); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// NewTarget is a destination some device contacted for the first time.
type NewTarget struct {
	DeviceKey  string `json:"device_key"`
	DeviceName string `json:"device_name"`
	Target     string `json:"target"`
	FirstSeen  int64  `json:"first_seen"`
}

// RecentNewTargets lists first contacts at or after since (ms), newest first,
// across all devices.
func (s *Store) RecentNewTargets(ctx context.Context, since int64, limit int) ([]NewTarget, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT t.device_key, COALESCE(d.kind,''), COALESCE(d.hostname,''), COALESCE(d.friendly_name,''), t.target, t.first_seen
		FROM device_targets t LEFT JOIN devices d ON d.key = t.device_key
		WHERE t.first_seen >= ? ORDER BY t.first_seen DESC LIMIT ?`, since, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []NewTarget
	for rows.Next() {
		var n NewTarget
		var kind, host, fr string
		if err := rows.Scan(&n.DeviceKey, &kind, &host, &fr, &n.Target, &n.FirstSeen); err != nil {
			return nil, err
		}
		if kind == "" {
			kind = KindOf(n.DeviceKey)
		}
		n.DeviceName = DisplayName(n.DeviceKey, kind, host, fr)
		out = append(out, n)
	}
	return out, rows.Err()
}

// RouteStat is traffic grouped by how it left the router.
type RouteStat struct {
	Route string `json:"route"`
	Up    int64  `json:"up"`
	Down  int64  `json:"down"`
	Conns int64  `json:"conns"`
}

// Routes groups flows created at or after since (ms) by route: the sing-box
// outbound, or the conntrack class for flows that bypass sing-box. It reads
// raw flows (absolute per-flow totals), so it only reaches back as far as
// flow retention and differs slightly from the hourly rollups.
func (s *Store) Routes(ctx context.Context, since int64) ([]RouteStat, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT CASE WHEN source = 'conntrack' THEN inbound WHEN outbound = '' THEN '?' ELSE outbound END AS r,
		SUM(up), SUM(down), COUNT(*) FROM flows WHERE created_at >= ? GROUP BY r ORDER BY SUM(up)+SUM(down) DESC`, since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []RouteStat
	for rows.Next() {
		var r RouteStat
		if err := rows.Scan(&r.Route, &r.Up, &r.Down, &r.Conns); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}
