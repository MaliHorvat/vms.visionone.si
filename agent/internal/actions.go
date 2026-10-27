package internal

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// executeCommand izvede daljinski ukaz LE, če je dejanje lokalno dovoljeno (definirano v config.json).
func (a *Agent) executeCommand(cmd Command) (string, map[string]interface{}) {
	local := a.cfg.localFor(cmd.DeviceID, cmd.DeviceIP)
	if local == nil || len(local.Actions) == 0 {
		return "error", map[string]interface{}{"error": "Dejanje ni lokalno dovoljeno. Dodaj ga v config.json (devices[].actions)."}
	}

	// ime želenega dejanja: iz params.action ali iz cmd.Action
	want := cmd.Action
	if len(cmd.Params) > 0 {
		var p struct {
			Action string `json:"action"`
		}
		if json.Unmarshal(cmd.Params, &p) == nil && p.Action != "" {
			want = p.Action
		}
	}

	act := pickAction(local.Actions, want)
	if act == nil {
		return "error", map[string]interface{}{"error": "Dejanje '" + want + "' ni definirano za to napravo."}
	}

	ip := cmd.DeviceIP
	if local.MatchIP != "" {
		ip = local.MatchIP
	}
	code, body, err := runAction(act, ip, a.cfg.Insecure)
	if err != nil {
		return "error", map[string]interface{}{"error": err.Error()}
	}
	if code >= 200 && code < 300 {
		return "done", map[string]interface{}{"http": code, "action": act.Name}
	}
	return "error", map[string]interface{}{"http": code, "body": trimTo(body, 300)}
}

func pickAction(actions []DeviceAction, want string) *DeviceAction {
	for i := range actions {
		if strings.EqualFold(actions[i].Name, want) {
			return &actions[i]
		}
	}
	// open_door -> prvo vrat/releja, če ni natančnega ujemanja
	if want == "open_door" || want == "relay_pulse" {
		return &actions[0]
	}
	return nil
}

func runAction(act *DeviceAction, ip string, globalInsecure bool) (int, string, error) {
	insecure := act.Insecure || globalInsecure
	ch := act.Channel
	if ch == 0 {
		ch = 1
	}
	switch strings.ToLower(act.Type) {
	case "hikvision":
		url := fmt.Sprintf("http://%s/ISAPI/AccessControl/RemoteControl/door/%d", ip, ch)
		xml := `<RemoteControlDoor><cmd>open</cmd></RemoteControlDoor>`
		return doDeviceRequest("PUT", url, act.Username, act.Password, xml, insecure)

	case "dahua":
		url := fmt.Sprintf("http://%s/cgi-bin/accessControl.cgi?action=openDoor&channel=%d&UserID=101&Type=Remote", ip, ch)
		return doDeviceRequest("GET", url, act.Username, act.Password, "", insecure)

	case "2n":
		url := fmt.Sprintf("http://%s/api/switch/ctrl?switch=%d&action=trigger", ip, ch)
		return doDeviceRequest("GET", url, act.Username, act.Password, "", insecure)

	case "shelly":
		url := act.URL
		if url == "" {
			url = fmt.Sprintf("http://%s/relay/%d?turn=on", ip, ch-1) // gen1
		}
		return doDeviceRequest("GET", url, act.Username, act.Password, "", insecure)

	case "ha":
		base := strings.TrimRight(act.URL, "/")
		url := base + "/api/services/switch/turn_on"
		body := fmt.Sprintf(`{"entity_id":"%s"}`, act.Entity)
		return haRequest(url, act.Token, body, insecure)

	case "http":
		method := act.Method
		if method == "" {
			method = "POST"
		}
		return doDeviceRequest(method, act.URL, act.Username, act.Password, act.Body, insecure)
	}
	return 0, "", errors.New("neznan tip dejanja: " + act.Type)
}

func haRequest(url, token, body string, insecure bool) (int, string, error) {
	cl := deviceHTTP(insecure, 8*time.Second)
	req, err := http.NewRequest("POST", url, strings.NewReader(body))
	if err != nil {
		return 0, "", err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Content-Type", "application/json")
	resp, err := cl.Do(req)
	if err != nil {
		return 0, "", err
	}
	defer resp.Body.Close()
	return resp.StatusCode, "", nil
}

func trimTo(s string, n int) string {
	if len(s) > n {
		return s[:n]
	}
	return s
}
