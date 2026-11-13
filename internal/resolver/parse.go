package resolver

import (
	"net"
	"net/netip"
	"slices"
	"strconv"
	"strings"
)

// RouterSnapshot is what one ssh pull of the router yields.
type RouterSnapshot struct {
	Leases      []Lease
	Static      []StaticHost
	Neigh       []Neighbour
	Addrs       []IfAddr
	HostsNames  map[string]string // ip -> name from /tmp/hosts/* (router names etc.)
	TunMark     uint32            // fwmark value that routes into the sing-box tun
	TunMarkMask uint32
}

type Lease struct {
	MAC, IP, Hostname string
}

type StaticHost struct {
	Name string
	MACs []string
	IP   string
}

type Neighbour struct {
	IP, MAC, Dev, State string
}

type IfAddr struct {
	Dev    string
	Prefix netip.Prefix
}

// normMAC lower-cases and validates a MAC address; returns "" if invalid.
func normMAC(s string) string {
	hw, err := net.ParseMAC(strings.TrimSpace(s))
	if err != nil || len(hw) != 6 {
		return ""
	}
	return hw.String()
}

// ParseLeases parses dnsmasq's /tmp/dhcp.leases. IPv6 lines (which carry an
// IAID instead of a MAC) and the "duid" line are skipped.
func ParseLeases(s string) []Lease {
	var out []Lease
	for _, line := range strings.Split(s, "\n") {
		f := strings.Fields(line)
		if len(f) < 4 {
			continue
		}
		mac := normMAC(f[1])
		if mac == "" {
			continue
		}
		ip, err := netip.ParseAddr(f[2])
		if err != nil {
			continue
		}
		name := f[3]
		if name == "*" {
			name = ""
		}
		out = append(out, Lease{MAC: mac, IP: ip.String(), Hostname: name})
	}
	return out
}

// ParseUCIHosts parses `uci show dhcp` output for host sections.
func ParseUCIHosts(s string) []StaticHost {
	type acc struct {
		name, ip string
		macs     []string
	}
	m := map[string]*acc{}
	var order []string
	for _, line := range strings.Split(s, "\n") {
		line = strings.TrimSpace(line)
		eq := strings.IndexByte(line, '=')
		if eq < 0 || !strings.HasPrefix(line, "dhcp.") {
			continue
		}
		path, val := line[:eq], strings.Trim(line[eq+1:], "'")
		parts := strings.Split(path, ".")
		if len(parts) == 2 {
			if val == "host" {
				if _, ok := m[parts[1]]; !ok {
					m[parts[1]] = &acc{}
					order = append(order, parts[1])
				}
			}
			continue
		}
		if len(parts) != 3 {
			continue
		}
		a, ok := m[parts[1]]
		if !ok {
			continue
		}
		switch parts[2] {
		case "name":
			a.name = val
		case "ip":
			a.ip = val
		case "mac":
			for _, x := range strings.Fields(strings.ReplaceAll(val, "' '", " ")) {
				if mac := normMAC(x); mac != "" {
					a.macs = append(a.macs, mac)
				}
			}
		}
	}
	var out []StaticHost
	for _, k := range order {
		a := m[k]
		if len(a.macs) == 0 {
			continue
		}
		out = append(out, StaticHost{Name: a.name, IP: a.ip, MACs: a.macs})
	}
	return out
}

// ParseNeigh parses `ip neigh show` / `ip -6 neigh show` output. Entries
// without a link-layer address (FAILED/INCOMPLETE) are dropped.
func ParseNeigh(s string) []Neighbour {
	var out []Neighbour
	for _, line := range strings.Split(s, "\n") {
		f := strings.Fields(line)
		if len(f) < 4 {
			continue
		}
		ip, err := netip.ParseAddr(f[0])
		if err != nil {
			continue
		}
		n := Neighbour{IP: ip.String()}
		for i := 1; i < len(f); i++ {
			switch f[i] {
			case "dev":
				if i+1 < len(f) {
					n.Dev = f[i+1]
				}
			case "lladdr":
				if i+1 < len(f) {
					n.MAC = normMAC(f[i+1])
				}
			}
		}
		n.State = f[len(f)-1]
		if n.MAC == "" {
			continue
		}
		out = append(out, n)
	}
	return out
}

// ParseAddrs parses `ip -o addr show` output.
func ParseAddrs(s string) []IfAddr {
	var out []IfAddr
	for _, line := range strings.Split(s, "\n") {
		f := strings.Fields(line)
		// "5: br-lan    inet 192.168.2.1/24 brd ... "
		if len(f) < 4 {
			continue
		}
		dev := strings.TrimSuffix(f[1], ":")
		if i := strings.IndexByte(dev, '@'); i >= 0 {
			dev = dev[:i]
		}
		if f[2] != "inet" && f[2] != "inet6" {
			continue
		}
		addr := f[3]
		if !strings.Contains(addr, "/") {
			if strings.Contains(addr, ":") {
				addr += "/128"
			} else {
				addr += "/32"
			}
		}
		p, err := netip.ParsePrefix(addr)
		if err != nil {
			continue
		}
		out = append(out, IfAddr{Dev: dev, Prefix: p})
	}
	return out
}

// ParseHostsFiles parses /etc/hosts style content.
func ParseHostsFiles(s string) map[string]string {
	out := map[string]string{}
	for _, line := range strings.Split(s, "\n") {
		if i := strings.IndexByte(line, '#'); i >= 0 {
			line = line[:i]
		}
		f := strings.Fields(line)
		if len(f) < 2 {
			continue
		}
		ip, err := netip.ParseAddr(f[0])
		if err != nil {
			continue
		}
		if _, ok := out[ip.String()]; !ok {
			out[ip.String()] = f[1]
		}
	}
	return out
}

// ParseTunMark extracts the fwmark/mask that sends packets to the sing-box
// tun routing table from `ip rule` output, e.g.
// "9001: from all fwmark 0x2023/0x2027 lookup 2022".
func ParseTunMark(s string) (mark, mask uint32, ok bool) {
	for _, line := range strings.Split(s, "\n") {
		f := strings.Fields(line)
		if slices.Contains(f, "not") {
			continue
		}
		for i := 0; i+3 < len(f); i++ {
			if f[i] == "fwmark" && f[i+2] == "lookup" && f[i+3] != "main" && f[i+3] != "default" && f[i+3] != "local" {
				mv := f[i+1]
				mk := "0xffffffff"
				if j := strings.IndexByte(mv, '/'); j >= 0 {
					mv, mk = mv[:j], mv[j+1:]
				}
				a, err1 := strconv.ParseUint(mv, 0, 32)
				b, err2 := strconv.ParseUint(mk, 0, 32)
				if err1 == nil && err2 == nil {
					return uint32(a), uint32(b), true
				}
			}
		}
	}
	return 0, 0, false
}

// Sections splits the output of the combined router command into named
// sections delimited by "##NAME" lines.
func Sections(s string) map[string]string {
	out := map[string]string{}
	var cur string
	var b strings.Builder
	flush := func() {
		if cur != "" {
			out[cur] = b.String()
		}
		b.Reset()
	}
	for _, line := range strings.Split(s, "\n") {
		if strings.HasPrefix(line, "##") && !strings.Contains(line, " ") {
			flush()
			cur = strings.TrimPrefix(line, "##")
			continue
		}
		b.WriteString(line)
		b.WriteByte('\n')
	}
	flush()
	return out
}

// RouterCommand is the read-only shell command run on the router.
const RouterCommand = `echo '##LEASES'; cat /tmp/dhcp.leases 2>/dev/null; ` +
	`echo '##UCI'; uci -q show dhcp 2>/dev/null; ` +
	`echo '##NEIGH4'; ip -4 neigh show 2>/dev/null; ` +
	`echo '##NEIGH6'; ip -6 neigh show 2>/dev/null; ` +
	`echo '##ADDR'; ip -o addr show 2>/dev/null; ` +
	`echo '##HOSTS'; cat /tmp/hosts/* 2>/dev/null; ` +
	`echo '##RULE'; ip rule show 2>/dev/null; echo '##END'`

// ParseRouterOutput parses the RouterCommand output.
func ParseRouterOutput(s string) RouterSnapshot {
	sec := Sections(s)
	snap := RouterSnapshot{
		Leases:     ParseLeases(sec["LEASES"]),
		Static:     ParseUCIHosts(sec["UCI"]),
		Neigh:      append(ParseNeigh(sec["NEIGH4"]), ParseNeigh(sec["NEIGH6"])...),
		Addrs:      ParseAddrs(sec["ADDR"]),
		HostsNames: ParseHostsFiles(sec["HOSTS"]),
	}
	if m, k, ok := ParseTunMark(sec["RULE"]); ok {
		snap.TunMark, snap.TunMarkMask = m, k
	}
	return snap
}
