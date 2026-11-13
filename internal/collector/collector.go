// Package collector keeps the sing-box SubscribeConnections stream open and
// persists the tracker's flows.
package collector

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"math/rand/v2"
	"sync"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/metadata"

	"netwatch/internal/flow"
	"netwatch/internal/pb"
	"netwatch/internal/resolver"
	"netwatch/internal/store"
	"netwatch/internal/tracker"
)

type Collector struct {
	API        string
	Secret     string
	Interval   time.Duration
	Checkpoint time.Duration
	Tracker    *tracker.Tracker
	Store      *store.Store
	Resolver   *resolver.Resolver
	Log        *slog.Logger

	mu          sync.Mutex
	connected   bool
	connectedAt time.Time
	lastErr     string
	reconnects  int64
}

type Status struct {
	Connected   bool      `json:"connected"`
	ConnectedAt time.Time `json:"connected_at"`
	LastError   string    `json:"last_error,omitempty"`
	Reconnects  int64     `json:"reconnects"`
}

func (c *Collector) Status() Status {
	c.mu.Lock()
	defer c.mu.Unlock()
	return Status{c.connected, c.connectedAt, c.lastErr, c.reconnects}
}

func (c *Collector) setState(connected bool, err error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.connected = connected
	if connected {
		c.connectedAt = time.Now()
	}
	if err != nil {
		c.lastErr = err.Error()
	}
}

// RunStream subscribes forever with exponential backoff.
func (c *Collector) RunStream(ctx context.Context) {
	conn, err := grpc.NewClient(c.API,
		grpc.WithTransportCredentials(insecure.NewCredentials()),
		grpc.WithDefaultCallOptions(grpc.MaxCallRecvMsgSize(64<<20)))
	if err != nil {
		c.Log.Error("grpc client", "err", err)
		return
	}
	defer conn.Close()
	client := pb.NewStartedServiceClient(conn)
	backoff := time.Second
	for ctx.Err() == nil {
		start := time.Now()
		err := c.subscribeOnce(ctx, client)
		c.setState(false, err)
		if ctx.Err() != nil {
			return
		}
		if time.Since(start) > time.Minute {
			backoff = time.Second
		}
		wait := backoff + time.Duration(rand.Int64N(int64(backoff/2)+1))
		c.Log.Warn("stream ended; reconnecting", "err", err, "in", wait.Round(time.Millisecond))
		c.mu.Lock()
		c.reconnects++
		c.mu.Unlock()
		select {
		case <-ctx.Done():
			return
		case <-time.After(wait):
		}
		backoff = min(backoff*2, time.Minute)
	}
}

const idleTimeout = 2 * time.Minute

func (c *Collector) subscribeOnce(ctx context.Context, client pb.StartedServiceClient) error {
	sctx, cancel := context.WithCancel(ctx)
	defer cancel()
	sctx = metadata.AppendToOutgoingContext(sctx, "authorization", "Bearer "+c.Secret)
	stream, err := client.SubscribeConnections(sctx, &pb.SubscribeConnectionsRequest{Interval: int64(c.Interval)})
	if err != nil {
		return err
	}
	// Watchdog: the server sends traffic updates every interval while any
	// connection moves bytes; a silent stream for this long is dead.
	activity := make(chan struct{}, 1)
	go func() {
		t := time.NewTimer(idleTimeout)
		defer t.Stop()
		for {
			select {
			case <-sctx.Done():
				return
			case <-activity:
				if !t.Stop() {
					<-t.C
				}
				t.Reset(idleTimeout)
			case <-t.C:
				c.Log.Warn("stream idle; cancelling", "after", idleTimeout)
				cancel()
				return
			}
		}
	}()
	first := true
	for {
		msg, err := stream.Recv()
		if err != nil {
			if errors.Is(err, io.EOF) {
				return errors.New("server closed stream")
			}
			return err
		}
		select {
		case activity <- struct{}{}:
		default:
		}
		if first {
			c.setState(true, nil)
			c.Log.Info("subscribed", "api", c.API, "snapshot_events", len(msg.GetEvents()))
			first = false
		}
		before := time.Now().UnixMilli()
		if res := c.Tracker.Apply(msg); res != nil {
			// Persist the snapshot, then close flows a previous run (or a
			// disconnect) left open that the server no longer has.
			c.Flush(ctx, false)
			n, err := c.Store.CloseStale(ctx, flow.SourceSingbox, res.OpenIDs, before)
			if err != nil {
				c.Log.Error("close stale flows", "err", err)
			} else if n > 0 || len(res.DroppedIDs) > 0 {
				c.Log.Info("reconciled after snapshot", "closed_stale_db", n, "dropped_in_memory", len(res.DroppedIDs), "open", len(res.OpenIDs))
			}
		}
	}
}

// Flush persists pending flows. checkpoint=true also writes byte progress of
// long-lived open connections.
func (c *Collector) Flush(ctx context.Context, checkpoint bool) {
	fs := c.Tracker.Drain(checkpoint)
	if len(fs) == 0 {
		return
	}
	for i := range fs {
		f := &fs[i]
		if len(f.DeviceKey) > 3 && f.DeviceKey[:3] == "ip:" && c.Resolver != nil {
			if k := c.Resolver.KeyFor(f); k != f.DeviceKey {
				f.DeviceKey = k
				if f.ClosedAt == 0 {
					c.Tracker.UpdateDeviceKey(f.ID, k)
				}
			}
		}
	}
	if err := c.Store.UpsertFlows(ctx, fs); err != nil {
		c.Log.Error("persist flows", "err", err, "n", len(fs))
		c.Tracker.Requeue(fs)
	}
}

// RunFlusher writes closed/new flows every few seconds and checkpoints open
// flows every Checkpoint interval. On ctx cancel it does a final checkpoint.
func (c *Collector) RunFlusher(ctx context.Context) {
	fast := time.NewTicker(5 * time.Second)
	defer fast.Stop()
	slow := time.NewTicker(c.Checkpoint)
	defer slow.Stop()
	for {
		select {
		case <-ctx.Done():
			c.Flush(context.Background(), true)
			return
		case <-fast.C:
			c.Flush(ctx, false)
		case <-slow.C:
			c.Flush(ctx, true)
		}
	}
}
