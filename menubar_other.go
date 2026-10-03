//go:build !linux

package main

import "github.com/wailsapp/wails/v3/pkg/application"

// setMenuBarVisible 在非 Linux 平台用 Wails 的原生实现：Windows 真正隐藏/恢复
// 菜单栏；macOS 是空实现（全屏时系统自动隐藏全局菜单栏，无需应用干预）。
func setMenuBarVisible(win *application.WebviewWindow, visible bool) {
	if win == nil {
		return
	}
	if visible {
		win.ShowMenuBar()
	} else {
		win.HideMenuBar()
	}
}
