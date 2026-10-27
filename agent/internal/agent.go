package internal

import (
	"fmt"
	"io"
	"log"
	"os"
	"time"
)

type Agent struct {
	cfg    *Config
	client *Client
	log    *log.Logger
}

func New(cfg *Config) *Agent {
	var w io.Writer = os.Stdout
	if cfg.LogFile != "" {
		if f, err := os.OpenFile(cfg.LogFile, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0644); err == nil {
			w = io.MultiWriter(os.Stdout, f)
		}
	}
	return &Agent{cfg: cfg, client: NewClient(cfg), log: log.New(w, "", log.LstdFlags)}
}

func (a *Agent) Logf(format string, args ...interface{}) { a.log.Printf(format, args...) }

// Run teče, dokler se stop ne zapre.
func (a *Agent) Run(stop <-chan struct{}) {
	a.Logf("VisionOne agent %s zagnan. Portal: %s", Version, a.cfg.PortalURL)
	interval := time.Duration(a.cfg.IntervalSec) * time.Second
	cycle := 0

	tick := func() {
		cfg, err := a.client.Config()
		if err != nil {
			a.Logf("napaka pri branju konfiguracije: %v", err)
			return
		}
		results, caps := a.runMonitors(cfg)
		body := &ReportBody{Version: Version, Results: results, Capabilities: caps}

		if a.cfg.DiscoverEvery > 0 && cycle%a.cfg.DiscoverEvery == 0 {
			a.Logf("odkrivanje naprav v omrežju …")
			body.Discovered = discover()
		}
		if err := a.client.Report(body); err != nil {
			a.Logf("napaka pri pošiljanju: %v", err)
		} else {
			up := 0
			for _, r := range results {
				if r.Up {
					up++
				}
			}
			a.Logf("poročilo poslano: %d/%d naprav online", up, len(results))
		}

		// ukazi
		cmds, err := a.client.Poll()
		if err != nil {
			a.Logf("napaka pri prevzemu ukazov: %v", err)
		}
		for _, c := range cmds {
			a.Logf("izvajam ukaz #%d: %s (naprava %d)", c.ID, c.Action, c.DeviceID)
			status, result := a.executeCommand(c)
			if err := a.client.Ack(c.ID, status, result); err != nil {
				a.Logf("napaka pri potrditvi ukaza #%d: %v", c.ID, err)
			} else {
				a.Logf("ukaz #%d -> %s", c.ID, status)
			}
		}
		cycle++
	}

	tick() // takoj ob zagonu
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-stop:
			a.Logf("agent se ustavlja.")
			return
		case <-t.C:
			func() {
				defer func() {
					if r := recover(); r != nil {
						a.Logf("obnovljena napaka v ciklu: %v", r)
					}
				}()
				tick()
			}()
		}
	}
}

// PrintStatus za ročni preizkus (flag --once).
func (a *Agent) Once() error {
	cfg, err := a.client.Config()
	if err != nil {
		return err
	}
	fmt.Printf("Lokacija: %s (naprav: %d)\n", cfg.Location.Name, len(cfg.Devices))
	results, _ := a.runMonitors(cfg)
	for i, r := range results {
		lat := "-"
		if r.LatencyMS != nil {
			lat = fmt.Sprintf("%d ms", *r.LatencyMS)
		}
		state := "ONLINE"
		if !r.Up {
			state = "IZPAD"
		}
		fmt.Printf("  %-28s %-8s %s\n", cfg.Devices[i].Name, state, lat)
	}
	return a.client.Report(&ReportBody{Version: Version, Results: results})
}
