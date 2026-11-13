// Package config loads netwatch configuration from a TOML file and
// environment variables (env wins).
package config

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/BurntSushi/toml"
)

// Duration is a TOML string like "45s".
type Duration struct{ time.Duration }

func (d *Duration) UnmarshalText(b []byte) error {
	v, err := time.ParseDuration(string(b))
	if err != nil {
		return err
	}
	d.Duration = v
	return nil
}

func (d Duration) MarshalText() ([]byte, error) { return []byte(d.String()), nil }

type Config struct {
	// ssh target for read-only router queries (leases, neighbours, conntrack)
	Router     string   `toml:"router"`
	SSHOptions []string `toml:"ssh_options"`
	// sing-box API (gRPC, plaintext) and its bearer secret
	API    string `toml:"api"`
	Secret string `toml:"secret"`

	Listen string `toml:"listen"`
	DB     string `toml:"db"`

	RetentionDays       int `toml:"retention_days"`        // raw flows
	RollupRetentionDays int `toml:"rollup_retention_days"` // hourly rollups, IP history

	StreamInterval     Duration `toml:"stream_interval"`     // sing-box update tick
	CheckpointInterval Duration `toml:"checkpoint_interval"` // persist open flows' bytes
	ResolveInterval    Duration `toml:"resolve_interval"`    // router device refresh

	Conntrack         bool     `toml:"conntrack"`
	ConntrackInterval Duration `toml:"conntrack_interval"`

	LANInterfaces []string `toml:"lan_interfaces"`
	TunInterface  string   `toml:"tun_interface"`

	Path string `toml:"-"`
}

func DefaultPath() string {
	if p := os.Getenv("NETWATCH_CONFIG"); p != "" {
		return p
	}
	dir, err := os.UserConfigDir()
	if err != nil {
		dir = filepath.Join(os.Getenv("HOME"), ".config")
	}
	return filepath.Join(dir, "netwatch", "config.toml")
}

func dataDir() string {
	if d := os.Getenv("XDG_DATA_HOME"); d != "" {
		return filepath.Join(d, "netwatch")
	}
	return filepath.Join(os.Getenv("HOME"), ".local", "share", "netwatch")
}

func Defaults() Config {
	return Config{
		Router:              "root@192.168.2.1",
		API:                 "192.168.2.1:9090",
		Listen:              "127.0.0.1:8377",
		DB:                  filepath.Join(dataDir(), "netwatch.db"),
		RetentionDays:       30,
		RollupRetentionDays: 730,
		StreamInterval:      Duration{2 * time.Second},
		CheckpointInterval:  Duration{60 * time.Second},
		ResolveInterval:     Duration{45 * time.Second},
		Conntrack:           true,
		ConntrackInterval:   Duration{20 * time.Second},
		LANInterfaces:       []string{"br-lan"},
		TunInterface:        "singbox_tun",
	}
}

// Load reads the config file (if present) and applies env overrides. A file
// containing a secret must not be readable by group/others.
func Load(path string) (Config, error) {
	c := Defaults()
	if path == "" {
		path = DefaultPath()
	}
	c.Path = path
	st, err := os.Stat(path)
	switch {
	case errors.Is(err, fs.ErrNotExist):
	case err != nil:
		return c, err
	default:
		if _, err := toml.DecodeFile(path, &c); err != nil {
			return c, fmt.Errorf("%s: %w", path, err)
		}
		if c.Secret != "" && st.Mode().Perm()&0o077 != 0 {
			return c, fmt.Errorf("%s contains a secret but has mode %#o; run: chmod 600 %s", path, st.Mode().Perm(), path)
		}
	}
	env := func(k string, dst *string) {
		if v := os.Getenv(k); v != "" {
			*dst = v
		}
	}
	env("NETWATCH_ROUTER", &c.Router)
	env("NETWATCH_API", &c.API)
	env("NETWATCH_SECRET", &c.Secret)
	env("NETWATCH_LISTEN", &c.Listen)
	env("NETWATCH_DB", &c.DB)
	if v := os.Getenv("NETWATCH_RETENTION_DAYS"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil {
			return c, fmt.Errorf("NETWATCH_RETENTION_DAYS: %w", err)
		}
		c.RetentionDays = n
	}
	if v := os.Getenv("NETWATCH_CONNTRACK"); v != "" {
		c.Conntrack = v == "1" || strings.EqualFold(v, "true")
	}
	if strings.HasPrefix(c.DB, "~/") {
		c.DB = filepath.Join(os.Getenv("HOME"), c.DB[2:])
	}
	if c.RetentionDays <= 0 {
		c.RetentionDays = 30
	}
	if c.RollupRetentionDays < c.RetentionDays {
		c.RollupRetentionDays = c.RetentionDays
	}
	return c, nil
}

// Template is written by `netwatch init-config`.
const Template = `# netwatch configuration. Keep this file mode 0600: it holds the API secret.

# ssh target used for read-only router queries (leases, neighbours, conntrack).
router = %q
# sing-box API (gRPC) address and bearer secret (services[0].secret in
# /etc/momo/run/config.json on the router).
api = %q
secret = %q

listen = %q
db = %q

retention_days = 30           # raw flows
rollup_retention_days = 730   # hourly per-device/domain rollups

stream_interval = "2s"
checkpoint_interval = "60s"
resolve_interval = "45s"

# Record flows sing-box cannot see, from the router's conntrack table.
conntrack = true
conntrack_interval = "20s"

lan_interfaces = ["br-lan"]
tun_interface = "singbox_tun"
`
