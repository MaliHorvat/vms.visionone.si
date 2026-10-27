package internal

import (
	"fmt"
	"net"
	"regexp"
	"strings"
	"time"
)

// tcpCheck poskusi TCP povezavo; vrne (dosegljivo, latenca v ms).
func tcpCheck(host string, port int, timeout time.Duration) (bool, int) {
	start := time.Now()
	conn, err := net.DialTimeout("tcp", fmt.Sprintf("%s:%d", host, port), timeout)
	if err != nil {
		return false, 0
	}
	conn.Close()
	return true, int(time.Since(start).Milliseconds())
}

// reachable: najprej ICMP (če je dovoljeno), sicer TCP na pogosta vrata.
func reachable(host string, ports []int, timeout time.Duration) (bool, int) {
	if ok, ms := icmpPing(host, timeout); ok {
		return true, ms
	}
	probe := ports
	if len(probe) == 0 {
		probe = []int{80, 443, 554, 8000, 22, 23, 8080, 37777}
	}
	for _, p := range probe {
		if ok, ms := tcpCheck(host, p, timeout); ok {
			return true, ms
		}
	}
	return false, 0
}

var reModel = regexp.MustCompile(`(?i)<model>([^<]+)</model>`)
var reFirm = regexp.MustCompile(`(?i)<firmwareVersion>([^<]+)</firmwareVersion>`)
var reMAC = regexp.MustCompile(`(?i)<macAddress>([^<]+)</macAddress>`)

// hikvisionInfo prebere model/firmware/MAC prek ISAPI.
func hikvisionInfo(ip, user, pass string, insecure bool) (model, firm, mac string) {
	for _, scheme := range []string{"http", "https"} {
		url := scheme + "://" + ip + "/ISAPI/System/deviceInfo"
		code, body, err := doDeviceRequest("GET", url, user, pass, "", insecure)
		if err == nil && code == 200 {
			if m := reModel.FindStringSubmatch(body); m != nil {
				model = strings.TrimSpace(m[1])
			}
			if m := reFirm.FindStringSubmatch(body); m != nil {
				firm = strings.TrimSpace(m[1])
			}
			if m := reMAC.FindStringSubmatch(body); m != nil {
				mac = strings.TrimSpace(m[1])
			}
			return
		}
	}
	return
}

// onvifInfo prek SOAP GetDeviceInformation (deluje za večino kamer/snemalnikov).
func onvifInfo(ip, user, pass string, insecure bool) (model, firm string) {
	body := `<?xml version="1.0"?><s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"><s:Body><GetDeviceInformation xmlns="http://www.onvif.org/ver10/device/wsdl"/></s:Body></s:Envelope>`
	for _, path := range []string{"/onvif/device_service", "/onvif/Device"} {
		for _, scheme := range []string{"http", "https"} {
			url := scheme + "://" + ip + path
			code, resp, err := doDeviceRequest("POST", url, user, pass, body, insecure)
			if err == nil && code == 200 {
				model = between(resp, "Model")
				firm = between(resp, "FirmwareVersion")
				if model != "" || firm != "" {
					return
				}
			}
		}
	}
	return
}

func between(s, tag string) string {
	re := regexp.MustCompile(`(?i)<[^>]*` + tag + `>([^<]+)</[^>]*` + tag + `>`)
	if m := re.FindStringSubmatch(s); m != nil {
		return strings.TrimSpace(m[1])
	}
	return ""
}
