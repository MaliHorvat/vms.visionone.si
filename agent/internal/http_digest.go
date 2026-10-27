package internal

import (
	"crypto/md5"
	"crypto/rand"
	"crypto/tls"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// httpClient z izbirno nezaupanja vrednim TLS (samopodpisani certifikati naprav).
func deviceHTTP(insecure bool, timeout time.Duration) *http.Client {
	return &http.Client{
		Timeout:       timeout,
		Transport:     &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: insecure}},
		CheckRedirect: func(r *http.Request, v []*http.Request) error { return http.ErrUseLastResponse },
	}
}

// doDeviceRequest izvede zahtevek z basic ali digest avtentikacijo (samodejno).
func doDeviceRequest(method, url, user, pass, body string, insecure bool) (int, string, error) {
	cl := deviceHTTP(insecure, 8*time.Second)
	mk := func() (*http.Request, error) {
		var rdr io.Reader
		if body != "" {
			rdr = strings.NewReader(body)
		}
		return http.NewRequest(method, url, rdr)
	}
	req, err := mk()
	if err != nil {
		return 0, "", err
	}
	if user != "" {
		req.SetBasicAuth(user, pass)
	}
	resp, err := cl.Do(req)
	if err != nil {
		return 0, "", err
	}
	if resp.StatusCode == 401 && user != "" {
		wa := resp.Header.Get("WWW-Authenticate")
		resp.Body.Close()
		if strings.HasPrefix(strings.ToLower(wa), "digest") {
			req2, _ := mk()
			req2.Header.Set("Authorization", digestHeader(method, url, user, pass, wa))
			resp, err = cl.Do(req2)
			if err != nil {
				return 0, "", err
			}
		}
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 256<<10))
	return resp.StatusCode, string(data), nil
}

func digestHeader(method, rawurl, user, pass, challenge string) string {
	p := parseChallenge(challenge)
	realm, nonce, qop, opaque, algorithm := p["realm"], p["nonce"], p["qop"], p["opaque"], p["algorithm"]
	uri := rawurl
	if i := strings.Index(rawurl, "://"); i >= 0 {
		if j := strings.Index(rawurl[i+3:], "/"); j >= 0 {
			uri = rawurl[i+3+j:]
		} else {
			uri = "/"
		}
	}
	ha1 := md5hex(user + ":" + realm + ":" + pass)
	ha2 := md5hex(method + ":" + uri)
	var resp string
	cnonce := randHex(8)
	nc := "00000001"
	if qop != "" {
		qop = "auth"
		resp = md5hex(ha1 + ":" + nonce + ":" + nc + ":" + cnonce + ":" + qop + ":" + ha2)
	} else {
		resp = md5hex(ha1 + ":" + nonce + ":" + ha2)
	}
	h := fmt.Sprintf(`Digest username="%s", realm="%s", nonce="%s", uri="%s", response="%s"`, user, realm, nonce, uri, resp)
	if algorithm != "" {
		h += fmt.Sprintf(`, algorithm=%s`, algorithm)
	}
	if qop != "" {
		h += fmt.Sprintf(`, qop=%s, nc=%s, cnonce="%s"`, qop, nc, cnonce)
	}
	if opaque != "" {
		h += fmt.Sprintf(`, opaque="%s"`, opaque)
	}
	return h
}

func parseChallenge(s string) map[string]string {
	out := map[string]string{}
	s = strings.TrimSpace(strings.TrimPrefix(strings.TrimPrefix(s, "Digest"), "digest"))
	for _, part := range splitComma(s) {
		kv := strings.SplitN(strings.TrimSpace(part), "=", 2)
		if len(kv) == 2 {
			out[strings.ToLower(strings.TrimSpace(kv[0]))] = strings.Trim(strings.TrimSpace(kv[1]), `"`)
		}
	}
	return out
}

// razdeli po vejicah, a ne znotraj narekovajev
func splitComma(s string) []string {
	var out []string
	var b strings.Builder
	inq := false
	for _, r := range s {
		if r == '"' {
			inq = !inq
		}
		if r == ',' && !inq {
			out = append(out, b.String())
			b.Reset()
			continue
		}
		b.WriteRune(r)
	}
	if b.Len() > 0 {
		out = append(out, b.String())
	}
	return out
}

func md5hex(s string) string { h := md5.Sum([]byte(s)); return hex.EncodeToString(h[:]) }
func randHex(n int) string   { b := make([]byte, n); rand.Read(b); return hex.EncodeToString(b) }
