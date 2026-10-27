package internal

import (
	"bytes"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"
)

const Version = "1.0.0"

// Naprava, kot jo vrne portal (/api/agent/config).
type RemoteDevice struct {
	ID      int             `json:"id"`
	Name    string          `json:"name"`
	Kind    string          `json:"kind"`
	IP      string          `json:"ip"`
	MAC     string          `json:"mac"`
	Vendor  string          `json:"vendor"`
	Model   string          `json:"model"`
	Monitor json.RawMessage `json:"monitor"`
}

type MonitorCfg struct {
	Ping  bool  `json:"ping"`
	Ports []int `json:"ports"`
	SNMP  *struct {
		Community string `json:"community"`
	} `json:"snmp"`
}

type AgentConfig struct {
	Location struct {
		ID   int
		Name string
	} `json:"location"`
	OfflineAfter   int            `json:"offlineAfter"`
	ReportInterval int            `json:"reportInterval"`
	Features       []string       `json:"features"`
	Devices        []RemoteDevice `json:"devices"`
}

// Rezultat nadzora ene naprave.
type Result struct {
	DeviceID  int                    `json:"device_id"`
	Up        bool                   `json:"up"`
	Warn      bool                   `json:"warn,omitempty"`
	LatencyMS *int                   `json:"latency_ms,omitempty"`
	CPU       *float64               `json:"cpu,omitempty"`
	Mem       *float64               `json:"mem,omitempty"`
	Disk      *float64               `json:"disk,omitempty"`
	Model     string                 `json:"model,omitempty"`
	Firmware  string                 `json:"firmware,omitempty"`
	MAC       string                 `json:"mac,omitempty"`
	Extra     map[string]interface{} `json:"extra,omitempty"`
}

type Discovered struct {
	IP     string `json:"ip"`
	MAC    string `json:"mac,omitempty"`
	Vendor string `json:"vendor,omitempty"`
	Ports  []int  `json:"ports,omitempty"`
}

type ReportBody struct {
	Version      string           `json:"version"`
	Results      []Result         `json:"results"`
	Discovered   []Discovered     `json:"discovered,omitempty"`
	Capabilities map[int][]string `json:"capabilities,omitempty"`
}

// Ukaz iz portala.
type Command struct {
	ID         int             `json:"id"`
	Action     string          `json:"action"`
	DeviceID   int             `json:"device_id"`
	DeviceIP   string          `json:"device_ip"`
	DeviceKind string          `json:"device_kind"`
	Params     json.RawMessage `json:"params"`
}

type Client struct {
	base  string
	token string
	http  *http.Client
}

func NewClient(c *Config) *Client {
	tr := &http.Transport{
		TLSClientConfig:     &tls.Config{InsecureSkipVerify: c.Insecure},
		MaxIdleConns:        4,
		IdleConnTimeout:     60 * time.Second,
		TLSHandshakeTimeout: 10 * time.Second,
	}
	return &Client{base: c.PortalURL, token: c.Token, http: &http.Client{Timeout: 25 * time.Second, Transport: tr}}
}

func (cl *Client) do(method, path string, body interface{}, out interface{}) error {
	var rdr io.Reader
	if body != nil {
		b, _ := json.Marshal(body)
		rdr = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, cl.base+path, rdr)
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+cl.token)
	req.Header.Set("User-Agent", "VisionOne-Agent/"+Version)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := cl.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if resp.StatusCode == 401 {
		return errors.New("portal je zavrnil žeton (401) – preveri VO_TOKEN")
	}
	if resp.StatusCode >= 300 {
		return fmt.Errorf("portal %s %s -> %d: %s", method, path, resp.StatusCode, string(data))
	}
	if out != nil && len(data) > 0 {
		return json.Unmarshal(data, out)
	}
	return nil
}

func (cl *Client) Config() (*AgentConfig, error) {
	var ac AgentConfig
	err := cl.do("GET", "/api/agent/config", nil, &ac)
	return &ac, err
}
func (cl *Client) Report(b *ReportBody) error { return cl.do("POST", "/api/agent/report", b, nil) }
func (cl *Client) Poll() ([]Command, error) {
	var out struct {
		Commands []Command `json:"commands"`
	}
	err := cl.do("GET", "/api/agent/poll", nil, &out)
	return out.Commands, err
}
func (cl *Client) Ack(id int, status string, result interface{}) error {
	return cl.do("POST", "/api/agent/ack", map[string]interface{}{"id": id, "status": status, "result": result}, nil)
}
