package biggie

import (
	"context"
	"io"
	"sync"
	"time"
)

type rateEvent struct {
	at     time.Time
	tokens int64
}

type RateInfo struct {
	RequestsUsed    int   `json:"requests_used"`
	RequestsLimit   int   `json:"requests_limit"`
	TokensUsed      int64 `json:"tokens_used"`
	TokensLimit     int64 `json:"tokens_limit"`
	TokensRemaining int64 `json:"tokens_remaining"`
	ResetSeconds    int64 `json:"reset_seconds"`
}

type HourlyLimiter struct {
	mu       sync.Mutex
	requests int
	tokens   int64
	events   map[string][]rateEvent
}

func NewHourlyLimiter(requests int, tokens int64) *HourlyLimiter {
	return &HourlyLimiter{requests: requests, tokens: tokens, events: make(map[string][]rateEvent)}
}

func (l *HourlyLimiter) snapshotLocked(key string, now time.Time) RateInfo {
	cutoff := now.Add(-time.Hour)
	events := l.events[key]
	first := 0
	for first < len(events) && events[first].at.Before(cutoff) {
		first++
	}
	if first > 0 {
		events = append([]rateEvent(nil), events[first:]...)
		l.events[key] = events
	}
	var used int64
	for _, event := range events {
		used += event.tokens
	}
	reset := int64(3600)
	if len(events) > 0 {
		remaining := time.Until(events[0].at.Add(time.Hour))
		reset = max(1, int64((remaining+time.Second-1)/time.Second))
	}
	return RateInfo{
		RequestsUsed: len(events), RequestsLimit: l.requests,
		TokensUsed: used, TokensLimit: l.tokens,
		TokensRemaining: max(0, l.tokens-used), ResetSeconds: reset,
	}
}

func (l *HourlyLimiter) Check(key string, tokens int64) (bool, string, RateInfo) {
	l.mu.Lock()
	defer l.mu.Unlock()
	info := l.snapshotLocked(key, time.Now())
	if info.RequestsUsed >= l.requests {
		return false, "rate_limit_requests", info
	}
	if info.TokensUsed+max(0, tokens) > l.tokens {
		return false, "rate_limit_tokens", info
	}
	return true, "ok", info
}

func (l *HourlyLimiter) Commit(key string, tokens int64) RateInfo {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	l.snapshotLocked(key, now)
	l.events[key] = append(l.events[key], rateEvent{at: now, tokens: max(0, tokens)})
	return l.snapshotLocked(key, now)
}

type SingleFlight struct {
	mu     sync.Mutex
	holder string
}

func (f *SingleFlight) Acquire(holder string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.holder != "" {
		return false
	}
	f.holder = holder
	return true
}

func (f *SingleFlight) Release(holder string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.holder == holder {
		f.holder = ""
	}
}

func (f *SingleFlight) Busy() bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.holder != ""
}

// Throttle is a process-wide token bucket used for request and response bytes.
type Throttle struct {
	mu      sync.Mutex
	rate    int64
	tokens  float64
	updated time.Time
}

func NewThrottle(bytesPerSecond int64) *Throttle {
	bytesPerSecond = max(1, bytesPerSecond)
	return &Throttle{rate: bytesPerSecond, tokens: float64(bytesPerSecond), updated: time.Now()}
}

func (t *Throttle) Wait(ctx context.Context, count int) error {
	remaining := float64(count)
	for remaining > 0 {
		t.mu.Lock()
		now := time.Now()
		t.tokens = min(float64(t.rate), t.tokens+now.Sub(t.updated).Seconds()*float64(t.rate))
		t.updated = now
		take := min(remaining, t.tokens)
		t.tokens -= take
		remaining -= take
		t.mu.Unlock()
		if remaining <= 0 {
			return nil
		}
		delay := time.Duration(min(.25, remaining/float64(t.rate)) * float64(time.Second))
		if delay < time.Millisecond {
			delay = time.Millisecond
		}
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return ctx.Err()
		case <-timer.C:
		}
	}
	return nil
}

type throttledReader struct {
	ctx context.Context
	r   io.Reader
	t   *Throttle
}

func (r throttledReader) Read(p []byte) (int, error) {
	n, err := r.r.Read(p)
	if n > 0 {
		if waitErr := r.t.Wait(r.ctx, n); waitErr != nil {
			return n, waitErr
		}
	}
	return n, err
}
