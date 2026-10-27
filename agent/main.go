package main

import (
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"visionone/agent/internal"
)

const usage = `VisionOne agent %s

Uporaba:
  visionone-agent [ukaz]

Ukazi:
  run         zaženi agenta (privzeto; na Windows samodejno zazna storitev)
  once        enkratni preizkus: preveri naprave in pošlji eno poročilo
  install     namesti kot Windows storitev (zaženi kot Administrator)
  uninstall   odstrani Windows storitev
  version     izpiši različico

Nastavitve: config.json poleg programa ali spremenljivke VO_PORTAL, VO_TOKEN.
`

func main() {
	cmd := "run"
	if len(os.Args) > 1 {
		cmd = os.Args[1]
	}

	switch cmd {
	case "version", "-v", "--version":
		fmt.Printf("VisionOne agent %s\n", internal.Version)
		return
	case "help", "-h", "--help":
		fmt.Printf(usage, internal.Version)
		return
	case "install":
		if err := internal.InstallService(); err != nil {
			fmt.Println("Napaka:", err)
			os.Exit(1)
		}
		fmt.Println("Storitev VisionOneAgent nameščena in zagnana.")
		return
	case "uninstall":
		if err := internal.UninstallService(); err != nil {
			fmt.Println("Napaka:", err)
			os.Exit(1)
		}
		fmt.Println("Storitev odstranjena.")
		return
	}

	cfg, err := internal.LoadConfig()
	if err != nil {
		fmt.Println("Napaka v nastavitvah:", err)
		os.Exit(1)
	}
	agent := internal.New(cfg)

	if cmd == "once" {
		if err := agent.Once(); err != nil {
			fmt.Println("Napaka:", err)
			os.Exit(1)
		}
		return
	}

	// Poskusi teči kot Windows storitev; če nismo v storitvi (ali ne-Windows), teci v ospredju.
	if internal.RunService(agent) {
		return
	}

	stop := make(chan struct{})
	sig := make(chan os.Signal, 1)
	signal.Notify(sig, os.Interrupt, syscall.SIGTERM)
	go func() { <-sig; close(stop) }()
	agent.Run(stop)
}
