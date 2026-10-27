//go:build !windows

package internal

import "errors"

// Na ne-Windows sistemih ni SCM – agent teče v ospredju (npr. v Dockerju ali prek systemd).
func RunService(a *Agent) bool { return false }

func InstallService() error {
	return errors.New("namestitev storitve je na voljo samo na Windows (v Dockerju uporabi restart: unless-stopped)")
}
func UninstallService() error { return errors.New("samo Windows") }
