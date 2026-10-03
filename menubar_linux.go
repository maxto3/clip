//go:build linux

package main

/*
#cgo linux pkg-config: gtk4
#include <gtk/gtk.h>

// clipSetMenuBarVisible 直接控制原生菜单栏控件的可见性。
//
// Wails alpha.98 的 HideMenuBar 在 Linux 是空实现，只能自己操作 GTK 控件：
// 建窗时窗口的 child 是纵向 GtkBox，菜单栏被 gtk_box_prepend 到该 Box 的第一位
// （webview 在其后，见 Wails windowNew），所以 first_child 就是菜单栏。
// 升级 Wails 后需要重新确认这一控件结构。
static void clipSetMenuBarVisible(GtkWidget *window, gboolean visible) {
	GtkWidget *content = gtk_window_get_child(GTK_WINDOW(window));
	if (content == NULL) {
		return;
	}
	GtkWidget *menuBar = gtk_widget_get_first_child(content);
	if (menuBar == NULL) {
		return;
	}
	gtk_widget_set_visible(menuBar, visible);
}
*/
import "C"

import "github.com/wailsapp/wails/v3/pkg/application"

// setMenuBarVisible 显示/隐藏应用菜单栏。GTK 调用统一切到主线程执行。
func setMenuBarVisible(win *application.WebviewWindow, visible bool) {
	if win == nil {
		return
	}
	native := win.NativeWindow()
	if native == nil {
		return
	}
	show := C.gboolean(0)
	if visible {
		show = 1
	}
	application.InvokeSync(func() {
		C.clipSetMenuBarVisible((*C.GtkWidget)(native), show)
	})
}
