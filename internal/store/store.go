// Package store persists flows, devices and hourly rollups in SQLite.
package store

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	_ "modernc.org/sqlite"

	"netwatch/internal/flow"
)

const schema = `
CREATE TABLE IF NOT EXISTS devices (
	key           TEXT PRIMARY KEY,          -- MAC | 'router' | 'inbound:<tag>[:user]' | 'ip:<addr>'
	kind          TEXT NOT NULL,             -- lan | router | remote | unknown
	hostname      TEXT NOT NULL DEFAULT '',
	friendly_name TEXT NOT NULL DEFAULT '',
	last_ip4      TEXT NOT NULL DEFAULT '',
	last_ip6      TEXT NOT NULL DEFAULT '',
	first_seen    INTEGER NOT NULL,          -- unix ms
	last_seen     INTEGER NOT NULL
);

-- Historical IP -> MAC observations (leases, static hosts, neighbour tables).
CREATE TABLE IF NOT EXISTS ip_mac (
	ip         TEXT NOT NULL,
	mac        TEXT NOT NULL,
	first_seen INTEGER NOT NULL,
	last_seen  INTEGER NOT NULL,
	src        TEXT NOT NULL,
	PRIMARY KEY (ip, mac)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS ip_mac_mac ON ip_mac(mac);

CREATE TABLE IF NOT EXISTS flows (
	rowid        INTEGER PRIMARY KEY,
	conn_id      TEXT NOT NULL UNIQUE,
	source       TEXT NOT NULL,              -- singbox | conntrack
	device_key   TEXT NOT NULL,
	src_ip       TEXT NOT NULL,
	src_port     INTEGER NOT NULL,
	dst_ip       TEXT NOT NULL,
	dst_port     INTEGER NOT NULL,
	domain       TEXT NOT NULL,
	target       TEXT NOT NULL,              -- domain, or dst_ip if no domain
	network      TEXT NOT NULL,
	protocol     TEXT NOT NULL,
	inbound      TEXT NOT NULL,
	inbound_type TEXT NOT NULL,
	outbound     TEXT NOT NULL,
	rule         TEXT NOT NULL,
	chain        TEXT NOT NULL,
	user         TEXT NOT NULL,
	ip_version   INTEGER NOT NULL,
	created_at   INTEGER NOT NULL,           -- unix ms (router clock for singbox)
	closed_at    INTEGER,                    -- NULL while open
	updated_at   INTEGER NOT NULL,           -- unix ms, local clock
	up           INTEGER NOT NULL,           -- absolute totals
	down         INTEGER NOT NULL,
	up_rolled    INTEGER NOT NULL DEFAULT 0, -- part of up/down already added to rollup_hourly
	down_rolled  INTEGER NOT NULL DEFAULT 0,
	ct_key       TEXT
);
CREATE INDEX IF NOT EXISTS flows_device_created ON flows(device_key, created_at);
CREATE INDEX IF NOT EXISTS flows_target_created ON flows(target, created_at);
CREATE INDEX IF NOT EXISTS flows_created ON flows(created_at);
CREATE INDEX IF NOT EXISTS flows_open ON flows(source) WHERE closed_at IS NULL;

-- Bytes attributed to the hour in which they were observed.
CREATE TABLE IF NOT EXISTS rollup_hourly (
	device_key TEXT NOT NULL,
	hour       INTEGER NOT NULL,             -- unix seconds, start of hour
	target     TEXT NOT NULL,
	up         INTEGER NOT NULL DEFAULT 0,
	down       INTEGER NOT NULL DEFAULT 0,
	conns      INTEGER NOT NULL DEFAULT 0,   -- flows first recorded in this hour
	PRIMARY KEY (device_key, hour, target)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS rollup_target_hour ON rollup_hourly(target, hour);
CREATE INDEX IF NOT EXISTS rollup_hour ON rollup_hourly(hour);

-- First/last time a device contacted a target; kept as long as rollups.
CREATE TABLE IF NOT EXISTS device_targets (
	device_key TEXT NOT NULL,
	target     TEXT NOT NULL,
	first_seen INTEGER NOT NULL,
	last_seen  INTEGER NOT NULL,
	PRIMARY KEY (device_key, target)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS device_targets_first ON device_targets(device_key, first_seen);
CREATE INDEX IF NOT EXISTS device_targets_target ON device_targets(target);
`

type Store struct {
	DB  *sql.DB
	wmu sync.Mutex // serialises writers
	Now func() time.Time
}

func Open(path string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, err
	}
	dsn := "file:" + path + "?_pragma=journal_mode(WAL)&_pragma=busy_timeout(10000)&_pragma=synchronous(NORMAL)&_txlock=immediate"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(4)
	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, fmt.Errorf("schema: %w", err)
	}
	return &Store{DB: db, Now: time.Now}, nil
}

func (s *Store) Close() error { return s.DB.Close() }

func hourOf(ms int64) int64 { return (ms / 1000) / 3600 * 3600 }

// DeviceInfo describes a device key for upserting into devices.
type DeviceInfo struct {
	Key      string
	Kind     string
	Hostname string
	IP       string
}

// KindOf derives the device kind from its key.
func KindOf(key string) string {
	switch {
	case key == "router":
		return "router"
	case strings.HasPrefix(key, "inbound:"):
		return "remote"
	case strings.HasPrefix(key, "ip:"):
		return "unknown"
	default:
		return "lan"
	}
}

// UpsertFlows writes flows (insert or update by conn_id) and moves any newly
// observed bytes into rollup_hourly. It is idempotent: writing the same
// absolute totals twice adds nothing to rollups.
func (s *Store) UpsertFlows(ctx context.Context, fs []flow.Flow) error {
	if len(fs) == 0 {
		return nil
	}
	s.wmu.Lock()
	defer s.wmu.Unlock()
	nowMs := s.Now().UnixMilli()
	hour := hourOf(nowMs)
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	sel, err := tx.PrepareContext(ctx, `SELECT device_key, up, down, up_rolled, down_rolled, target FROM flows WHERE conn_id = ?`)
	if err != nil {
		return err
	}
	ins, err := tx.PrepareContext(ctx, `INSERT INTO flows (conn_id, source, device_key, src_ip, src_port, dst_ip, dst_port, domain, target,
		network, protocol, inbound, inbound_type, outbound, rule, chain, user, ip_version, created_at, closed_at, updated_at, up, down, up_rolled, down_rolled, ct_key)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
	if err != nil {
		return err
	}
	upd, err := tx.PrepareContext(ctx, `UPDATE flows SET device_key = ?, domain = ?, target = ?, closed_at = COALESCE(?, closed_at),
		updated_at = ?, up = ?, down = ?, up_rolled = ?, down_rolled = ? WHERE conn_id = ?`)
	if err != nil {
		return err
	}
	roll, err := tx.PrepareContext(ctx, `INSERT INTO rollup_hourly (device_key, hour, target, up, down, conns) VALUES (?,?,?,?,?,?)
		ON CONFLICT(device_key, hour, target) DO UPDATE SET up = up + excluded.up, down = down + excluded.down, conns = conns + excluded.conns`)
	if err != nil {
		return err
	}
	dt, err := tx.PrepareContext(ctx, `INSERT INTO device_targets (device_key, target, first_seen, last_seen) VALUES (?,?,?,?)
		ON CONFLICT(device_key, target) DO UPDATE SET last_seen = MAX(last_seen, excluded.last_seen), first_seen = MIN(first_seen, excluded.first_seen)`)
	if err != nil {
		return err
	}
	dev, err := tx.PrepareContext(ctx, `INSERT INTO devices (key, kind, first_seen, last_seen) VALUES (?,?,?,?)
		ON CONFLICT(key) DO UPDATE SET last_seen = MAX(last_seen, excluded.last_seen)`)
	if err != nil {
		return err
	}

	for i := range fs {
		f := &fs[i]
		if f.DeviceKey == "" {
			f.DeviceKey = "ip:" + f.SrcIP
		}
		target := f.Target()
		var closed any
		if f.ClosedAt != 0 {
			closed = f.ClosedAt
		}
		var ctKey any
		if f.CTKey != "" {
			ctKey = f.CTKey
		}
		var oldKey, oldTarget string
		var oldUp, oldDown, rolledUp, rolledDown int64
		err := sel.QueryRowContext(ctx, f.ID).Scan(&oldKey, &oldUp, &oldDown, &rolledUp, &rolledDown, &oldTarget)
		isNew := false
		switch {
		case err == sql.ErrNoRows:
			isNew = true
		case err != nil:
			return err
		}
		up, down := f.Up, f.Down
		key := f.DeviceKey
		if !isNew {
			up = max(up, oldUp)
			down = max(down, oldDown)
			// Keep the attribution made at flow time unless it was unresolved.
			if !strings.HasPrefix(oldKey, "ip:") || strings.HasPrefix(key, "ip:") {
				key = oldKey
			}
			if f.Domain == "" {
				target = oldTarget
			}
		}
		dUp, dDown := up-rolledUp, down-rolledDown
		if dUp < 0 {
			dUp = 0
		}
		if dDown < 0 {
			dDown = 0
		}
		if isNew {
			_, err = ins.ExecContext(ctx, f.ID, f.Source, key, f.SrcIP, f.SrcPort, f.DstIP, f.DstPort, f.Domain, target,
				f.Network, f.Protocol, f.Inbound, f.InboundType, f.Outbound, f.Rule, f.Chain, f.User, f.IPVersion,
				f.CreatedAt, closed, nowMs, up, down, up, down, ctKey)
		} else {
			domain := f.Domain
			if domain == "" && target != f.DstIP {
				domain = target
			}
			_, err = upd.ExecContext(ctx, key, domain, target, closed, nowMs, up, down, rolledUp+dUp, rolledDown+dDown, f.ID)
		}
		if err != nil {
			return err
		}
		conns := 0
		if isNew {
			conns = 1
		}
		if dUp > 0 || dDown > 0 || isNew {
			if _, err := roll.ExecContext(ctx, key, hour, target, dUp, dDown, conns); err != nil {
				return err
			}
		}
		if _, err := dt.ExecContext(ctx, key, target, nowMs, nowMs); err != nil {
			return err
		}
		if _, err := dev.ExecContext(ctx, key, KindOf(key), nowMs, nowMs); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// CloseStale marks open flows of a source as closed when they were last
// written before `before` and are not in keepIDs. Used after a sing-box
// snapshot (reset) to close flows left open by a previous run or a
// disconnect. closed_at is set to the last time we saw them.
func (s *Store) CloseStale(ctx context.Context, source string, keepIDs []string, before int64) (int64, error) {
	s.wmu.Lock()
	defer s.wmu.Unlock()
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `CREATE TEMP TABLE IF NOT EXISTS keep_ids (id TEXT PRIMARY KEY)`); err != nil {
		return 0, err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM keep_ids`); err != nil {
		return 0, err
	}
	stmt, err := tx.PrepareContext(ctx, `INSERT OR IGNORE INTO keep_ids (id) VALUES (?)`)
	if err != nil {
		return 0, err
	}
	for _, id := range keepIDs {
		if _, err := stmt.ExecContext(ctx, id); err != nil {
			return 0, err
		}
	}
	res, err := tx.ExecContext(ctx, `UPDATE flows SET closed_at = updated_at
		WHERE closed_at IS NULL AND source = ? AND updated_at < ? AND conn_id NOT IN (SELECT id FROM keep_ids)`, source, before)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	if _, err := tx.ExecContext(ctx, `DELETE FROM keep_ids`); err != nil {
		return 0, err
	}
	return n, tx.Commit()
}

// OpenConntrackFlows returns conntrack flows still open in the DB, so the
// poller can continue them after a restart instead of creating duplicates.
func (s *Store) OpenConntrackFlows(ctx context.Context) ([]flow.Flow, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT conn_id, device_key, ct_key, src_ip, src_port, dst_ip, dst_port, network, inbound, ip_version, created_at, updated_at, up, down
		FROM flows WHERE source = ? AND closed_at IS NULL AND ct_key IS NOT NULL`, flow.SourceConntrack)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []flow.Flow
	for rows.Next() {
		f := flow.Flow{Source: flow.SourceConntrack}
		if err := rows.Scan(&f.ID, &f.DeviceKey, &f.CTKey, &f.SrcIP, &f.SrcPort, &f.DstIP, &f.DstPort, &f.Network, &f.Inbound, &f.IPVersion, &f.CreatedAt, &f.UpdatedAt, &f.Up, &f.Down); err != nil {
			return nil, err
		}
		f.InboundType = "conntrack"
		out = append(out, f)
	}
	return out, rows.Err()
}

// RecordIPMAC records observations of ip->mac.
type IPMAC struct {
	IP, MAC, Src string
}

func (s *Store) RecordNeighbours(ctx context.Context, obs []IPMAC, hosts map[string]DeviceInfo) error {
	s.wmu.Lock()
	defer s.wmu.Unlock()
	nowMs := s.Now().UnixMilli()
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	st, err := tx.PrepareContext(ctx, `INSERT INTO ip_mac (ip, mac, first_seen, last_seen, src) VALUES (?,?,?,?,?)
		ON CONFLICT(ip, mac) DO UPDATE SET last_seen = excluded.last_seen, src = excluded.src`)
	if err != nil {
		return err
	}
	for _, o := range obs {
		if _, err := st.ExecContext(ctx, o.IP, o.MAC, nowMs, nowMs, o.Src); err != nil {
			return err
		}
	}
	dv, err := tx.PrepareContext(ctx, `INSERT INTO devices (key, kind, hostname, last_ip4, last_ip6, first_seen, last_seen) VALUES (?,?,?,?,?,?,?)
		ON CONFLICT(key) DO UPDATE SET
			hostname = CASE WHEN excluded.hostname != '' THEN excluded.hostname ELSE hostname END,
			last_ip4 = CASE WHEN excluded.last_ip4 != '' THEN excluded.last_ip4 ELSE last_ip4 END,
			last_ip6 = CASE WHEN excluded.last_ip6 != '' THEN excluded.last_ip6 ELSE last_ip6 END`)
	if err != nil {
		return err
	}
	for _, h := range hosts {
		ip4, ip6 := "", ""
		if strings.Contains(h.IP, ":") {
			ip6 = h.IP
		} else {
			ip4 = h.IP
		}
		if _, err := dv.ExecContext(ctx, h.Key, h.Kind, h.Hostname, ip4, ip6, nowMs, nowMs); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// LoadIPHistory returns all ip->mac observations ordered by last_seen.
func (s *Store) LoadIPHistory(ctx context.Context) ([]IPMACSeen, error) {
	rows, err := s.DB.QueryContext(ctx, `SELECT ip, mac, last_seen FROM ip_mac ORDER BY last_seen`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []IPMACSeen
	for rows.Next() {
		var r IPMACSeen
		if err := rows.Scan(&r.IP, &r.MAC, &r.LastSeen); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

type IPMACSeen struct {
	IP, MAC  string
	LastSeen int64
}

func (s *Store) SetFriendlyName(ctx context.Context, key, name string) error {
	s.wmu.Lock()
	defer s.wmu.Unlock()
	nowMs := s.Now().UnixMilli()
	_, err := s.DB.ExecContext(ctx, `INSERT INTO devices (key, kind, friendly_name, first_seen, last_seen) VALUES (?,?,?,?,?)
		ON CONFLICT(key) DO UPDATE SET friendly_name = excluded.friendly_name`, key, KindOf(key), name, nowMs, nowMs)
	return err
}

// Prune deletes closed flows older than flowRetention and rollups / IP
// history / first-seen records older than rollupRetention.
func (s *Store) Prune(ctx context.Context, flowRetention, rollupRetention time.Duration) (int64, int64, error) {
	s.wmu.Lock()
	defer s.wmu.Unlock()
	now := s.Now()
	res, err := s.DB.ExecContext(ctx, `DELETE FROM flows WHERE closed_at IS NOT NULL AND closed_at < ?`, now.Add(-flowRetention).UnixMilli())
	if err != nil {
		return 0, 0, err
	}
	nf, _ := res.RowsAffected()
	cut := now.Add(-rollupRetention)
	res, err = s.DB.ExecContext(ctx, `DELETE FROM rollup_hourly WHERE hour < ?`, cut.Unix())
	if err != nil {
		return nf, 0, err
	}
	nr, _ := res.RowsAffected()
	if _, err := s.DB.ExecContext(ctx, `DELETE FROM ip_mac WHERE last_seen < ?`, cut.UnixMilli()); err != nil {
		return nf, nr, err
	}
	if _, err := s.DB.ExecContext(ctx, `DELETE FROM device_targets WHERE last_seen < ?`, cut.UnixMilli()); err != nil {
		return nf, nr, err
	}
	return nf, nr, nil
}
