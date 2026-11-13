// Package sshrun runs read-only commands on the router via the system ssh
// client, reusing one multiplexed connection.
package sshrun

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

type Runner struct {
	Target string   // e.g. root@192.168.2.1
	Extra  []string // extra ssh options
}

func (r *Runner) args(cmd string) []string {
	a := []string{
		"-o", "BatchMode=yes",
		"-o", "ConnectTimeout=10",
		"-o", "ServerAliveInterval=15",
		"-o", "ServerAliveCountMax=2",
	}
	if dir := os.Getenv("XDG_RUNTIME_DIR"); dir != "" {
		a = append(a,
			"-o", "ControlMaster=auto",
			"-o", "ControlPath="+filepath.Join(dir, "netwatch-ssh-%C"),
			"-o", "ControlPersist=300",
		)
	}
	a = append(a, r.Extra...)
	a = append(a, r.Target, cmd)
	return a
}

// Run executes cmd on the router and returns stdout.
func (r *Runner) Run(ctx context.Context, cmd string) (string, error) {
	c := exec.CommandContext(ctx, "ssh", r.args(cmd)...)
	var out, errb bytes.Buffer
	c.Stdout = &out
	c.Stderr = &errb
	c.Stdin = nil
	if err := c.Run(); err != nil {
		return out.String(), fmt.Errorf("ssh %s: %w: %s", r.Target, err, strings.TrimSpace(firstLine(errb.String())))
	}
	return out.String(), nil
}

func firstLine(s string) string {
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		return s[:i]
	}
	return s
}
