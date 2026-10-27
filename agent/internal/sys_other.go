//go:build !linux && !windows

package internal

// Rezerva za ostale sisteme (npr. macOS pri razvoju).
func hostMetrics(diskPath string) (cpu, mem, disk float64) { return 0, 0, 0 }
