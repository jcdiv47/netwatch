// Command netwatch records which LAN device talks to which domains, using
// the sing-box connection stream on the router, and serves a web UI.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"netwatch/internal/collector"
	"netwatch/internal/config"
	"netwatch/internal/conntrack"
	"netwatch/internal/resolver"
	"netwatch/internal/sshrun"
	"netwatch/internal/store"
	"netwatch/internal/tracker"
	"netwatch/internal/web"
)

func usage() {
	fmt.Fprintf(os.Stderr, `usage: netwatch [-config path] [run|init-config]

  run          run collector + web UI (default)
  init-config  write %s (mode 0600), reading the API secret
               from the router over ssh (read-only)
`, config.DefaultPath())
	flag.PrintDefaults()
}

func main() {
	cfgPath := flag.String("config", "", "config file (default "+config.DefaultPath()+", or $NETWATCH_CONFIG)")
	flag.Usage = usage
	flag.Parse()
	cmd := flag.Arg(0)
	if cmd == "" {
		cmd = "run"
	}
	log := slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelInfo}))
	var err error
	switch cmd {
	case "run":
		err = run(*cfgPath, log)
	case "init-config":
		err = initConfig(*cfgPath)
	default:
		usage()
		os.Exit(2)
	}
	if err != nil {
		log.Error("fatal", "err", err)
		os.Exit(1)
	}
}

func initConfig(path string) error {
	if path == "" {
		path = config.DefaultPath()
	}
	if _, err := os.Stat(path); err == nil {
		return fmt.Errorf("%s already exists; edit it instead", path)
	}
	c := config.Defaults()
	if v := os.Getenv("NETWATCH_ROUTER"); v != "" {
		c.Router = v
	}
	r := &sshrun.Runner{Target: c.Router}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	out, err := r.Run(ctx, `jsonfilter -i /etc/momo/run/config.json -e '@.services[0].secret'`)
	if err != nil {
		return fmt.Errorf("reading secret from router: %w", err)
	}
	secret := strings.TrimSpace(out)
	if secret == "" {
		return errors.New("router returned an empty secret")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	body := fmt.Sprintf(config.Template, c.Router, c.API, secret, c.Listen, c.DB)
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return err
	}
	if _, err := f.WriteString(body); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	fmt.Printf("wrote %s (mode 0600; secret not shown)\n", path)
	return nil
}

func run(cfgPath string, log *slog.Logger) error {
	cfg, err := config.Load(cfgPath)
	if err != nil {
		return err
	}
	if cfg.Secret == "" {
		return fmt.Errorf("no API secret configured (set secret in %s or NETWATCH_SECRET; `netwatch init-config` creates the file)", cfg.Path)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	st, err := store.Open(cfg.DB)
	if err != nil {
		return fmt.Errorf("open db: %w", err)
	}
	defer st.Close()
	log.Info("database", "path", cfg.DB)

	ssh := &sshrun.Runner{Target: cfg.Router, Extra: cfg.SSHOptions}
	res := resolver.New(ssh.Run, st, resolver.Options{
		LANInterfaces: cfg.LANInterfaces, TunInterface: cfg.TunInterface, Interval: cfg.ResolveInterval.Duration,
	}, log.With("c", "resolver"))
	if err := res.LoadHistory(ctx); err != nil {
		return fmt.Errorf("load ip history: %w", err)
	}
	// Resolve devices before the first snapshot arrives, so its flows are
	// attributed. A failure here is not fatal; the loop retries.
	if err := res.Refresh(ctx); err != nil {
		log.Warn("initial router refresh failed", "err", err)
	} else {
		_, _, n, _ := res.Status()
		log.Info("router state loaded", "known_ips", n)
	}

	tr := tracker.New(res.KeyFor)
	col := &collector.Collector{
		API: cfg.API, Secret: cfg.Secret, Interval: cfg.StreamInterval.Duration, Checkpoint: cfg.CheckpointInterval.Duration,
		Tracker: tr, Store: st, Resolver: res, Log: log.With("c", "stream"),
	}

	var ct *conntrack.Poller
	if cfg.Conntrack {
		ct = conntrack.NewPoller(ssh.Run, res, st, cfg.ConntrackInterval.Duration, log.With("c", "conntrack"))
		if err := ct.Restore(ctx); err != nil {
			return fmt.Errorf("restore conntrack flows: %w", err)
		}
	}

	var wg sync.WaitGroup
	goRun := func(f func(context.Context)) {
		wg.Add(1)
		go func() { defer wg.Done(); f(ctx) }()
	}
	goRun(res.Run)
	goRun(col.RunStream)
	goRun(col.RunFlusher)
	if ct != nil {
		goRun(ct.Run)
	}
	goRun(func(ctx context.Context) {
		prune := func() {
			nf, nr, err := st.Prune(ctx, time.Duration(cfg.RetentionDays)*24*time.Hour, time.Duration(cfg.RollupRetentionDays)*24*time.Hour)
			if err != nil {
				log.Warn("prune", "err", err)
			} else if nf > 0 || nr > 0 {
				log.Info("pruned", "flows", nf, "rollups", nr)
			}
		}
		prune()
		t := time.NewTicker(time.Hour)
		defer t.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-t.C:
				prune()
			}
		}
	})

	srv := &http.Server{
		Addr:              cfg.Listen,
		Handler:           (&web.Server{Store: st, Tracker: tr, Collector: col, Resolver: res, Conntrack: ct, Log: log.With("c", "web"), Started: time.Now()}).Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}
	ln, err := net.Listen("tcp", cfg.Listen)
	if err != nil {
		return err
	}
	log.Info("listening", "addr", "http://"+ln.Addr().String())
	go func() {
		if err := srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			log.Error("http", "err", err)
			stop()
		}
	}()

	<-ctx.Done()
	log.Info("shutting down")
	sctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = srv.Shutdown(sctx)
	wg.Wait() // flusher does a final checkpoint
	return nil
}
