package internal

import (
	"encoding/json"
	"net"
	"strings"
	"time"
)

func isLocal(ip string) bool {
	if ip == "" || ip == "127.0.0.1" || ip == "localhost" || ip == "::1" {
		return true
	}
	addrs, _ := net.InterfaceAddrs()
	for _, a := range addrs {
		if ipn, ok := a.(*net.IPNet); ok && ipn.IP.String() == ip {
			return true
		}
	}
	return false
}

// runMonitors preveri vse naprave in vrne rezultate + zmožnosti (dejanja).
func (a *Agent) runMonitors(cfg *AgentConfig) ([]Result, map[int][]string) {
	results := make([]Result, 0, len(cfg.Devices))
	caps := map[int][]string{}
	timeout := 3 * time.Second

	for _, d := range cfg.Devices {
		var mon MonitorCfg
		if len(d.Monitor) > 0 {
			_ = json.Unmarshal(d.Monitor, &mon)
		}
		local := a.cfg.localFor(d.ID, d.IP)
		res := Result{DeviceID: d.ID}

		switch {
		case d.Kind == "server" && (isLocal(d.IP) || (local != nil && local.Extra["local"] == "1")):
			cpu, mem, disk := hostMetrics(localDiskPath(local))
			res.Up = true
			res.CPU, res.Mem, res.Disk = &cpu, &mem, &disk
			ms := 0
			res.LatencyMS = &ms
			if local != nil && local.Extra["docker"] == "1" {
				if ok, total, running, down := dockerStats(a.cfg.DockerSocket); ok {
					res.Extra = map[string]interface{}{"docker_total": total, "docker_running": running}
					if len(down) > 0 {
						res.Warn = true
						res.Extra["docker_down"] = down
					}
				}
			}

		case mon.SNMP != nil && mon.SNMP.Community != "" && d.IP != "":
			vals, err := snmpGet(d.IP, mon.SNMP.Community, []string{snmpSysDescr, snmpSysUptime}, timeout)
			if err == nil {
				res.Up = true
				ms := 0
				res.LatencyMS = &ms
				res.Extra = map[string]interface{}{}
				if v := vals[snmpSysDescr]; v != "" {
					res.Extra["descr"] = v
				}
				if v := vals[snmpSysUptime]; v != "" {
					res.Extra["uptime"] = v
				}
			} else {
				up, lat := reachable(d.IP, mon.Ports, timeout)
				res.Up = up
				if up {
					res.LatencyMS = &lat
				}
			}

		default:
			if d.IP == "" {
				res.Up = false
			} else {
				up, lat := reachable(d.IP, mon.Ports, timeout)
				res.Up = up
				if up {
					res.LatencyMS = &lat
				}
			}
		}

		// obogati inventar kamer/snemalnikov
		if res.Up && (d.Kind == "camera" || d.Kind == "nvr") && local != nil && local.Username != "" {
			insecure := a.cfg.Insecure
			model, firm, mac := hikvisionInfo(d.IP, local.Username, local.Password, insecure)
			if model == "" {
				model, firm = onvifInfo(d.IP, local.Username, local.Password, insecure)
			}
			res.Model, res.Firmware = model, firm
			if mac != "" {
				res.MAC = mac
			}
		}

		// zmožnosti (daljinska dejanja)
		if local != nil && len(local.Actions) > 0 {
			names := make([]string, 0, len(local.Actions))
			for _, act := range local.Actions {
				names = append(names, act.Name)
			}
			caps[d.ID] = names
		} else if d.Kind == "domofon" {
			caps[d.ID] = []string{"open_door"}
		}

		results = append(results, res)
	}
	return results, caps
}

func localDiskPath(d *DeviceLocal) string {
	if d != nil {
		if p := d.Extra["disk"]; p != "" {
			return p
		}
	}
	return ""
}

func trimName(s string) string { return strings.TrimSpace(s) }
