package main

// Platform status — port of src/platform-status.js. The dashboard's platform
// bar only shows platforms that have connected at least once.

import "sync"

type PlatformStatus struct {
	mu        sync.Mutex
	s         map[string]bool
	ever      map[string]bool
	listeners []func()
}

func NewPlatformStatus() *PlatformStatus {
	return &PlatformStatus{s: map[string]bool{}, ever: map[string]bool{}}
}

func (p *PlatformStatus) OnChange(fn func()) {
	p.mu.Lock()
	p.listeners = append(p.listeners, fn)
	p.mu.Unlock()
}

func (p *PlatformStatus) Set(name string, ok bool) {
	p.mu.Lock()
	if ok {
		p.ever[name] = true
	}
	if prev, had := p.s[name]; had && prev == ok {
		p.mu.Unlock()
		return
	}
	p.s[name] = ok
	ls := p.listeners
	p.mu.Unlock()
	for _, fn := range ls {
		fn()
	}
}

func (p *PlatformStatus) All() map[string]bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	out := make(map[string]bool, len(p.s))
	for k, v := range p.s {
		out[k] = v
	}
	return out
}

func (p *PlatformStatus) Visible() map[string]bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	out := map[string]bool{}
	for k, v := range p.s {
		if p.ever[k] {
			out[k] = v
		}
	}
	return out
}
