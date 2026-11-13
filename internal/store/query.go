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
	ID         string  `json:"id"`
	Source     string  `json:"source"`
	DeviceKey  string  `json:"device_key"`
	DeviceName string  `json:"device_name"`
	SrcIP      string  `json:"src_ip"`
	SrcPort    int     `json:"src_port"`
	DstIP      string  `json:"dst_ip"`
	DstPort    int     `json:"dst_port"`
	Domain     string  `json:"domain"`
	Target     string  `json:"target"`
	Network    string  `json:"network"`
	Protocol   string  `json:"protocol"`
	Inbound    string  `json:"inbound"`
	Outbound   string  `json:"outbound"`
	Chain      string  `json:"chain"`
	CreatedAt  int64   `json:"created_at"`
	ClosedAt   *int64  `json:"closed_at"`
	Up         int64   `json:"up"`
	Down       int64   `json:"down"`
	RateUp     float64 `json:"rate_up,omitempty"`
	RateDown   float64 `json:"rate_down,omitempty"`
}

// RecentFlows by device or target (one set).
func (s *Store) RecentFlows(ctx context.Context, deviceKey, target string, limit int) ([]FlowRow, error) {
	col, val := "f.device_key", deviceKey
	if deviceKey == "" {
		col, val = "f.target", target
	}
	rows, err := s.DB.QueryContext(ctx, `SELECT f.conn_id, f.source, f.device_key, COALESCE(d.kind,''), COALESCE(d.hostname,''), COALESCE(d.friendly_name,''),
		f.src_ip, f.src_port, f.dst_ip, f.dst_port, f.domain, f.target, f.network, f.protocol, f.inbound, f.outbound, f.chain,
		f.created_at, f.closed_at, f.up, f.down
		FROM flows f LEFT JOIN devices d ON d.key = f.device_key
		WHERE `+col+` = ? ORDER BY f.created_at DESC LIMIT ?`, val, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []FlowRow
	for rows.Next() {
		var r FlowRow
		var kind, host, fr string
		var closed sql.NullInt64
		if err := rows.Scan(&r.ID, &r.Source, &r.DeviceKey, &kind, &host, &fr, &r.SrcIP, &r.SrcPort, &r.DstIP, &r.DstPort,
			&r.Domain, &r.Target, &r.Network, &r.Protocol, &r.Inbound, &r.Outbound, &r.Chain, &r.CreatedAt, &closed, &r.Up, &r.Down); err != nil {
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
