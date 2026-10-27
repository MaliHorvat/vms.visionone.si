package internal

import (
	"errors"
	"fmt"
	"net"
	"strconv"
	"strings"
	"time"
)

// Minimalni SNMPv2c GET (brez zunanjih knjižnic). Dovolj za nadzor dosegljivosti
// in branje osnovnih OID (sysDescr, sysUpTime ...).

func snmpGet(host, community string, oids []string, timeout time.Duration) (map[string]string, error) {
	pdu, err := buildGet(community, oids)
	if err != nil {
		return nil, err
	}
	conn, err := net.DialTimeout("udp", host+":161", timeout)
	if err != nil {
		return nil, err
	}
	defer conn.Close()
	conn.SetDeadline(time.Now().Add(timeout))
	if _, err := conn.Write(pdu); err != nil {
		return nil, err
	}
	buf := make([]byte, 4096)
	n, err := conn.Read(buf)
	if err != nil {
		return nil, err
	}
	return parseResponse(buf[:n])
}

// ── kodiranje ──
func tlv(tag byte, content []byte) []byte {
	return append(append([]byte{tag}, encLen(len(content))...), content...)
}
func encLen(n int) []byte {
	if n < 128 {
		return []byte{byte(n)}
	}
	var b []byte
	for n > 0 {
		b = append([]byte{byte(n & 0xff)}, b...)
		n >>= 8
	}
	return append([]byte{byte(0x80 | len(b))}, b...)
}
func encInt(n int) []byte {
	if n == 0 {
		return tlv(0x02, []byte{0})
	}
	var b []byte
	neg := n < 0
	un := n
	if neg {
		un = -n
	}
	for un > 0 {
		b = append([]byte{byte(un & 0xff)}, b...)
		un >>= 8
	}
	if b[0]&0x80 != 0 {
		b = append([]byte{0}, b...)
	}
	return tlv(0x02, b)
}
func encOID(oid string) ([]byte, error) {
	parts := strings.Split(strings.TrimPrefix(oid, "."), ".")
	if len(parts) < 2 {
		return nil, errors.New("neveljaven OID")
	}
	nums := make([]int, len(parts))
	for i, p := range parts {
		v, err := strconv.Atoi(p)
		if err != nil {
			return nil, err
		}
		nums[i] = v
	}
	out := []byte{byte(nums[0]*40 + nums[1])}
	for _, v := range nums[2:] {
		out = append(out, base128(v)...)
	}
	return tlv(0x06, out), nil
}
func base128(v int) []byte {
	if v == 0 {
		return []byte{0}
	}
	var b []byte
	for v > 0 {
		b = append([]byte{byte(v & 0x7f)}, b...)
		v >>= 7
	}
	for i := 0; i < len(b)-1; i++ {
		b[i] |= 0x80
	}
	return b
}

func buildGet(community string, oids []string) ([]byte, error) {
	var vbs []byte
	for _, o := range oids {
		oidBytes, err := encOID(o)
		if err != nil {
			return nil, err
		}
		vb := tlv(0x30, append(oidBytes, tlv(0x05, nil)...)) // OID + NULL
		vbs = append(vbs, vb...)
	}
	vbList := tlv(0x30, vbs)
	reqID := int(time.Now().UnixNano() & 0x7fffffff)
	pdu := tlv(0xA0, concat(encInt(reqID), encInt(0), encInt(0), vbList))  // GetRequest
	msg := tlv(0x30, concat(encInt(1), tlv(0x04, []byte(community)), pdu)) // version=1 (v2c), community
	return msg, nil
}
func concat(parts ...[]byte) []byte {
	var out []byte
	for _, p := range parts {
		out = append(out, p...)
	}
	return out
}

// ── razčlenjevanje ──
func parseResponse(data []byte) (map[string]string, error) {
	out := map[string]string{}
	seq, err := expect(data, 0x30)
	if err != nil {
		return nil, err
	}
	rest := seq
	_, rest = readTLV(rest)              // version
	_, rest = readTLV(rest)              // community
	pduBody, _ := readTLVTag(rest, 0xA2) // GetResponse
	if pduBody == nil {
		return nil, errors.New("ni SNMP odgovora")
	}
	b := pduBody
	_, b = readTLV(b) // request-id
	_, b = readTLV(b) // error-status
	_, b = readTLV(b) // error-index
	vbList, _ := readTLVTag(b, 0x30)
	vb := vbList
	for len(vb) > 0 {
		var one []byte
		one, vb = readTLVTag(vb, 0x30)
		if one == nil {
			break
		}
		oidVal, rem := readTLV(one)
		valTag := byte(0)
		if len(rem) > 0 {
			valTag = rem[0]
		}
		valContent, _ := readTLV(rem)
		out[oidToString(oidVal)] = decodeVal(valTag, valContent)
	}
	return out, nil
}

func decodeVal(tag byte, c []byte) string {
	switch tag {
	case 0x02, 0x41, 0x42, 0x43: // integer, counter, gauge, timeticks
		var n uint64
		for _, x := range c {
			n = n<<8 | uint64(x)
		}
		return strconv.FormatUint(n, 10)
	case 0x04: // octet string
		return string(c)
	case 0x06:
		return oidToString(c)
	default:
		return fmt.Sprintf("%x", c)
	}
}
func oidToString(c []byte) string {
	if len(c) == 0 {
		return ""
	}
	parts := []string{strconv.Itoa(int(c[0]) / 40), strconv.Itoa(int(c[0]) % 40)}
	v := 0
	for _, b := range c[1:] {
		v = v<<7 | int(b&0x7f)
		if b&0x80 == 0 {
			parts = append(parts, strconv.Itoa(v))
			v = 0
		}
	}
	return strings.Join(parts, ".")
}

// readTLV vrne vsebino prvega TLV in preostanek.
func readTLV(b []byte) (content, rest []byte) {
	if len(b) < 2 {
		return nil, nil
	}
	i := 1
	l := int(b[i])
	i++
	if l&0x80 != 0 {
		nb := l & 0x7f
		l = 0
		for j := 0; j < nb && i < len(b); j++ {
			l = l<<8 | int(b[i])
			i++
		}
	}
	if i+l > len(b) {
		return nil, nil
	}
	return b[i : i+l], b[i+l:]
}
func readTLVTag(b []byte, tag byte) (content, rest []byte) {
	if len(b) < 1 || b[0] != tag {
		return nil, b
	}
	c, r := readTLV(b)
	return c, r
}
func expect(b []byte, tag byte) ([]byte, error) {
	if len(b) < 1 || b[0] != tag {
		return nil, errors.New("nepričakovan SNMP zapis")
	}
	c, _ := readTLV(b)
	return c, nil
}

var snmpSysDescr = "1.3.6.1.2.1.1.1.0"
var snmpSysUptime = "1.3.6.1.2.1.1.3.0"
