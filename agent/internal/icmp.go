package internal

import (
	"net"
	"os"
	"time"
)

// icmpPing pošlje ICMP echo. Deluje s pravicami (Windows SYSTEM, root/Docker).
// Brez pravic vrne false in nadzor pade na TCP preverjanje.
func icmpPing(host string, timeout time.Duration) (bool, int) {
	ipAddr, err := net.ResolveIPAddr("ip4", host)
	if err != nil {
		return false, 0
	}
	conn, err := net.DialTimeout("ip4:icmp", ipAddr.String(), timeout)
	if err != nil {
		return false, 0
	}
	defer conn.Close()

	id := os.Getpid() & 0xffff
	pkt := icmpEcho(id, 1, []byte("visionone-ping"))
	start := time.Now()
	conn.SetDeadline(time.Now().Add(timeout))
	if _, err := conn.Write(pkt); err != nil {
		return false, 0
	}
	buf := make([]byte, 1500)
	for {
		n, err := conn.Read(buf)
		if err != nil {
			return false, 0
		}
		// preskoči IP glavo (IHL*4)
		if n < 28 {
			continue
		}
		ihl := int(buf[0]&0x0f) * 4
		if n < ihl+8 {
			continue
		}
		icmpType := buf[ihl]
		if icmpType == 0 { // echo reply
			return true, int(time.Since(start).Milliseconds())
		}
	}
}

func icmpEcho(id, seq int, data []byte) []byte {
	b := make([]byte, 8+len(data))
	b[0] = 8 // type echo request
	b[1] = 0
	b[4] = byte(id >> 8)
	b[5] = byte(id)
	b[6] = byte(seq >> 8)
	b[7] = byte(seq)
	copy(b[8:], data)
	cs := checksum(b)
	b[2] = byte(cs >> 8)
	b[3] = byte(cs)
	return b
}

func checksum(b []byte) uint16 {
	var sum uint32
	for i := 0; i < len(b)-1; i += 2 {
		sum += uint32(b[i])<<8 | uint32(b[i+1])
	}
	if len(b)%2 == 1 {
		sum += uint32(b[len(b)-1]) << 8
	}
	for sum>>16 != 0 {
		sum = (sum & 0xffff) + (sum >> 16)
	}
	return ^uint16(sum)
}
