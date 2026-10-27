package internal

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
)

// DeviceAction je lokalno definirano dejanje (npr. odpiranje vrat).
// Poverilnice ostanejo pri agentu – portal jih nikoli ne prejme.
type DeviceAction struct {
	Name     string `json:"name"`               // npr. "open_door"
	Type     string `json:"type"`               // hikvision | dahua | 2n | shelly | ha | http
	URL      string `json:"url,omitempty"`      // za http/shelly/ha ali osnovni naslov naprave
	Method   string `json:"method,omitempty"`   // privzeto POST/PUT glede na tip
	Username string `json:"username,omitempty"` // digest/basic prijava naprave
	Password string `json:"password,omitempty"`
	Body     string `json:"body,omitempty"`  // neobvezno telo zahtevka
	Token    string `json:"token,omitempty"` // npr. HA dolgoživi žeton
	Entity   string `json:"entity,omitempty"`
	Channel  int    `json:"channel,omitempty"` // številka vrat/releja
	Insecure bool   `json:"insecure,omitempty"`
}

// DeviceLocal poveže napravo v portalu (po IP ali ID) z lokalnimi dejanji in poverilnicami.
type DeviceLocal struct {
	MatchIP  string            `json:"ip,omitempty"`        // ujemanje po IP
	DeviceID int               `json:"device_id,omitempty"` // ali po ID iz portala
	Username string            `json:"username,omitempty"`  // poverilnice za nadzor (ONVIF/ISAPI)
	Password string            `json:"password,omitempty"`
	Actions  []DeviceAction    `json:"actions,omitempty"`
	Extra    map[string]string `json:"extra,omitempty"`
}

type Config struct {
	PortalURL     string        `json:"portal_url"`
	Token         string        `json:"token"`
	IntervalSec   int           `json:"interval_sec"`
	DiscoverEvery int           `json:"discover_every"` // na koliko ciklov odkrivanje (0 = izklop)
	Insecure      bool          `json:"insecure_tls"`
	LogFile       string        `json:"log_file"`
	Devices       []DeviceLocal `json:"devices"`
	DockerSocket  string        `json:"docker_socket"` // npr. /var/run/docker.sock ali npipe
	path          string
}

func defaultConfig() *Config {
	return &Config{IntervalSec: 45, DiscoverEvery: 20}
}

// LoadConfig prebere config.json poleg izvršljive datoteke (ali iz VO_CONFIG),
// vrednosti pa lahko prepišejo okoljske spremenljivke VO_PORTAL, VO_TOKEN, VO_INSECURE.
func LoadConfig() (*Config, error) {
	c := defaultConfig()
	p := os.Getenv("VO_CONFIG")
	if p == "" {
		if exe, err := os.Executable(); err == nil {
			p = filepath.Join(filepath.Dir(exe), "config.json")
		}
	}
	c.path = p
	if p != "" {
		if data, err := os.ReadFile(p); err == nil {
			if err := json.Unmarshal(data, c); err != nil {
				return nil, errors.New("config.json ni veljaven JSON: " + err.Error())
			}
		}
	}
	if v := os.Getenv("VO_PORTAL"); v != "" {
		c.PortalURL = v
	}
	if v := os.Getenv("VO_TOKEN"); v != "" {
		c.Token = v
	}
	if os.Getenv("VO_INSECURE") == "1" {
		c.Insecure = true
	}
	c.PortalURL = strings.TrimRight(c.PortalURL, "/")
	if c.IntervalSec < 15 {
		c.IntervalSec = 15
	}
	if c.PortalURL == "" || c.Token == "" {
		return c, errors.New("manjka portal_url ali token (nastavi config.json ali VO_PORTAL/VO_TOKEN)")
	}
	return c, nil
}

// localFor poišče lokalno definicijo za napravo po ID ali IP.
func (c *Config) localFor(id int, ip string) *DeviceLocal {
	for i := range c.Devices {
		d := &c.Devices[i]
		if d.DeviceID != 0 && d.DeviceID == id {
			return d
		}
		if d.MatchIP != "" && d.MatchIP == ip {
			return d
		}
	}
	return nil
}
