// Package flow defines the flow record shared by the collector sources,
// the store and the web API.
package flow

import (
	"net/netip"
	"strconv"
)

const (
	SourceSingbox   = "singbox"
	SourceConntrack = "conntrack"
)

// Flow is one connection as seen by a collector source. Byte counters are
// absolute totals for the lifetime of the connection (never deltas), which
// makes persisting them idempotent.
type Flow struct {
	ID          string // sing-box connection UUID, or "ct-..." for conntrack
	Source      string // SourceSingbox | SourceConntrack
	DeviceKey   string // resolved device key at flow time
	Inbound     string // sing-box inbound tag, or conntrack class ("ct:forward" ...)
	InboundType string
	Network     string // tcp/udp/icmp
	Protocol    string // sniffed protocol (tls/http/quic/...)
	User        string
	Outbound    string
	Rule        string
	Chain       string
	IPVersion   int
	SrcIP       string
	SrcPort     int
	DstIP       string
	DstPort     int
	Domain      string
	CreatedAt   int64 // unix ms
	ClosedAt    int64 // unix ms, 0 while open
	Up, Down    int64 // absolute totals, from the device's point of view
	UpdatedAt   int64 // unix ms of last byte change seen locally
	CTKey       string

	// Instantaneous rate estimate (bytes/s), for the live view only.
	RateUp, RateDown float64
}

// Target is what a flow is grouped by: the sniffed domain, or the
// destination IP when no domain is known.
func (f *Flow) Target() string {
	if f.Domain != "" {
		return f.Domain
	}
	return f.DstIP
}

// SplitHostPort splits "ip:port" / "[v6]:port" as produced by sing-box's
// M.Socksaddr.String(). Returns the input as host if it cannot be parsed.
func SplitHostPort(s string) (string, int) {
	if ap, err := netip.ParseAddrPort(s); err == nil {
		return ap.Addr().Unmap().String(), int(ap.Port())
	}
	// Domain destinations look like "example.com:443".
	for i := len(s) - 1; i >= 0; i-- {
		if s[i] == ':' {
			if p, err := strconv.Atoi(s[i+1:]); err == nil {
				return s[:i], p
			}
			break
		}
	}
	return s, 0
}
