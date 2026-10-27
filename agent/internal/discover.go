package internal

import (
	"fmt"
	"net"
	"os/exec"
	"regexp"
	"runtime"
	"strings"
	"sync"
	"time"
)

var reIPd = regexp.MustCompile(`(\d+\.\d+\.\d+\.\d+)`)
var reMACarp = regexp.MustCompile(`([0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}`)

// arpTable prebere sistemsko ARP tabelo (ip->mac).
func arpTable() map[string]string {
	out := map[string]string{}
	var cmd *exec.Cmd
	if runtime.GOOS == "windows" {
		cmd = exec.Command("arp", "-a")
	} else {
		cmd = exec.Command("ip", "neigh")
	}
	data, err := cmd.Output()
	if err != nil && runtime.GOOS != "windows" {
		data, _ = exec.Command("arp", "-an").Output()
	}
	for _, line := range strings.Split(string(data), "\n") {
		ip := reIPd.FindString(line)
		mac := reMACarp.FindString(line)
		if ip != "" && mac != "" {
			m := strings.ToLower(strings.ReplaceAll(mac, "-", ":"))
			if m != "ff:ff:ff:ff:ff:ff" && !strings.HasPrefix(m, "00:00:00") {
				out[ip] = m
			}
		}
	}
	return out
}

// discover poišče žive naprave v lokalnih /24 omrežjih (TCP sveženj + ARP).
func discover() []Discovered {
	subnets := localSubnets()
	arp := arpTable()
	seen := map[string]*Discovered{}
	var mu sync.Mutex
	ports := []int{80, 443, 554, 8000, 37777, 22, 23, 8080, 9000, 161}
	sem := make(chan struct{}, 128)
	var wg sync.WaitGroup

	for _, base := range subnets {
		for i := 1; i < 255; i++ {
			ip := fmt.Sprintf("%s.%d", base, i)
			wg.Add(1)
			sem <- struct{}{}
			go func(ip string) {
				defer wg.Done()
				defer func() { <-sem }()
				var open []int
				for _, p := range ports {
					if ok, _ := tcpCheck(ip, p, 350*time.Millisecond); ok {
						open = append(open, p)
					}
				}
				if len(open) == 0 {
					return
				}
				mu.Lock()
				seen[ip] = &Discovered{IP: ip, MAC: arp[ip], Vendor: ouiVendor(arp[ip]), Ports: open}
				mu.Unlock()
			}(ip)
		}
	}
	wg.Wait()

	out := make([]Discovered, 0, len(seen))
	for _, d := range seen {
		out = append(out, *d)
	}
	return out
}

func localSubnets() []string {
	var subs []string
	addrs, _ := net.InterfaceAddrs()
	for _, a := range addrs {
		ipn, ok := a.(*net.IPNet)
		if !ok || ipn.IP.To4() == nil || ipn.IP.IsLoopback() {
			continue
		}
		ones, _ := ipn.Mask.Size()
		if ones < 23 { // preveliko omrežje – preskoči za hitrost
			continue
		}
		p := ipn.IP.To4()
		base := fmt.Sprintf("%d.%d.%d", p[0], p[1], p[2])
		if !contains(subs, base) {
			subs = append(subs, base)
		}
	}
	return subs
}
func contains(s []string, v string) bool {
	for _, x := range s {
		if x == v {
			return true
		}
	}
	return false
}

// Groba prepoznava proizvajalca iz MAC (le nekaj najpogostejših).
var oui = map[string]string{
	"bc:ad:28": "Hikvision", "44:19:b6": "Hikvision", "c0:56:e3": "Hikvision", "4c:bd:8f": "Hikvision",
	"3c:ef:8c": "Dahua", "90:02:a9": "Dahua", "14:a7:8b": "Dahua", "bc:32:5f": "Dahua",
	"00:40:8c": "Axis", "ac:cc:8e": "Axis", "68:72:51": "Ubiquiti", "74:83:c2": "Ubiquiti", "fc:ec:da": "Ubiquiti",
	"00:11:32": "Synology", "00:08:9b": "QNAP", "00:1c:27": "Reolink", "ec:71:db": "Reolink",
}

func ouiVendor(mac string) string {
	if len(mac) < 8 {
		return ""
	}
	return oui[mac[:8]]
}
