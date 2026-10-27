package internal

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"strings"
	"time"
)

// Povezava na lokalni Docker (unix vtičnica ali tcp://). Windows named pipe ni podprt.
func dockerClient(socket string) (*http.Client, string) {
	if socket == "" {
		socket = "/var/run/docker.sock"
	}
	if strings.HasPrefix(socket, "tcp://") {
		return &http.Client{Timeout: 6 * time.Second}, "http://" + strings.TrimPrefix(socket, "tcp://")
	}
	tr := &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		var d net.Dialer
		return d.DialContext(ctx, "unix", socket)
	}}
	return &http.Client{Timeout: 6 * time.Second, Transport: tr}, "http://unix"
}

type dockerContainer struct {
	Names  []string `json:"Names"`
	State  string   `json:"State"`
	Status string   `json:"Status"`
}

// dockerStats vrne povzetek vsebnikov (skupaj, teče, ustavljeni) in seznam padlih.
func dockerStats(socket string) (ok bool, total, running int, down []string) {
	cl, base := dockerClient(socket)
	resp, err := cl.Get(base + "/containers/json?all=1")
	if err != nil {
		return false, 0, 0, nil
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return false, 0, 0, nil
	}
	var list []dockerContainer
	if err := json.NewDecoder(resp.Body).Decode(&list); err != nil {
		return false, 0, 0, nil
	}
	total = len(list)
	for _, c := range list {
		if c.State == "running" {
			running++
		} else {
			name := ""
			if len(c.Names) > 0 {
				name = strings.TrimPrefix(c.Names[0], "/")
			}
			down = append(down, name)
		}
	}
	return true, total, running, down
}
