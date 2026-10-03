package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/wailsapp/wails/v3/pkg/updater"
)

// TestUpdaterI18nInjection 验证更新窗口的 i18n 注入：占位符被替换、字典是合法 JSON、
// 且三语言的 "updater" key 集合一致（防止本地化漏项 / locale 结构漂移）。
func TestUpdaterI18nInjection(t *testing.T) {
	dict := updaterI18nDict()

	// 字典应是 {"en":{...},"zh":{...}} 的合法 JSON。
	var parsed map[string]map[string]interface{}
	if err := json.Unmarshal([]byte(dict), &parsed); err != nil {
		t.Fatalf("dict 不是合法 JSON: %v", err)
	}
	en, ok := parsed["en"]
	if !ok || len(en) == 0 {
		t.Fatal("dict 缺少非空 en 段")
	}
	zh, ok := parsed["zh"]
	if !ok || len(zh) == 0 {
		t.Fatal("dict 缺少非空 zh 段")
	}
	zhTW, ok := parsed["zh-TW"]
	if !ok || len(zhTW) == 0 {
		t.Fatal("dict 缺少非空 zh-TW 段")
	}

	// en/zh 的 key 必须一致（递归比较支持嵌套结构）。
	var compareKeys func(path string, a, b map[string]interface{})
	compareKeys = func(path string, a, b map[string]interface{}) {
		for k := range a {
			fullKey := path + k
			if _, ok := b[k]; !ok {
				t.Errorf("zh 缺少 key %q", fullKey)
				continue
			}
			// 如果值是嵌套对象，递归比较
			if aMap, aOk := a[k].(map[string]interface{}); aOk {
				if bMap, bOk := b[k].(map[string]interface{}); bOk {
					compareKeys(fullKey+".", aMap, bMap)
				}
			}
		}
		for k := range b {
			fullKey := path + k
			if _, ok := a[k]; !ok {
				t.Errorf("en 缺少 key %q", fullKey)
			}
		}
	}
	compareKeys("", en, zh)
	compareKeys("", en, zhTW)

	// 注入后占位符应全部消失，且选定语言出现在结果中。
	html := buildSoftwareUpdateHTML(dict, "zh")
	if strings.Contains(html, updI18nDictMarker) {
		t.Errorf("注入后仍残留字典占位符 %s", updI18nDictMarker)
	}
	if strings.Contains(html, updI18nLangMarker) {
		t.Errorf("注入后仍残留语言占位符 %s", updI18nLangMarker)
	}
	if !strings.Contains(html, `var lang = "zh"`) {
		t.Error("注入后未见 var lang = \"zh\"")
	}
	traditionalHTML := buildSoftwareUpdateHTML(dict, "zh-TW")
	if !strings.Contains(traditionalHTML, `var lang = "zh-TW"`) {
		t.Error("注入后未见 var lang = \"zh-TW\"")
	}
	// 抽查一个已知 key 的中文文案确实进入了 HTML（检查顶级 key）。
	if zhClose, ok := zh["close"].(string); ok && zhClose != "" && !strings.Contains(html, zhClose) {
		t.Errorf("注入后未见 zh.close 文案 %q", zhClose)
	}
	if close, ok := zhTW["close"].(string); ok && close != "" && !strings.Contains(traditionalHTML, close) {
		t.Errorf("注入后未见 zh-TW.close 文案 %q", close)
	}
}

// updaterTKeyRE 抓取 window.html 里 t("…") 的字面量 key。要求引号后紧跟 , 或 )，以排除
// 唯一的拼接调用 t("stages." + stage)——那个由下面显式拼出的 stages.* 覆盖。
var updaterTKeyRE = regexp.MustCompile(`\bt\("([^"]+)"\s*[,)]`)

// lookupDotted 复刻 window.html 里 lookup() 的取值语义：按 "." 下钻，只接受字符串叶子。
func lookupDotted(seg map[string]interface{}, key string) (string, bool) {
	var cur interface{} = seg
	for _, part := range strings.Split(key, ".") {
		m, ok := cur.(map[string]interface{})
		if !ok {
			return "", false
		}
		cur, ok = m[part]
		if !ok {
			return "", false
		}
	}
	s, ok := cur.(string)
	return s, ok
}

// TestUpdaterWindowKeysResolve 验证 window.html 里每个 t() 调用的 key 在三份 locale 中
// 都能取到字符串文案。
//
// 这条断言存在的原因：窗口的 t() 曾只做扁平查表，而 locale 的 errors / stages 是嵌套
// 对象，于是 t("errors.networkError") 取不到值、把 key 本身当文案渲染给用户
// （表现为「download时出错：errors.networkError」），renderError 的整套错误分类形同虚设。
// 纯前端 HTML 无法被 vitest 覆盖，只能从 Go 侧对文件做静态校验。
func TestUpdaterWindowKeysResolve(t *testing.T) {
	var parsed map[string]map[string]interface{}
	if err := json.Unmarshal([]byte(updaterI18nDict()), &parsed); err != nil {
		t.Fatalf("dict 不是合法 JSON: %v", err)
	}

	matches := updaterTKeyRE.FindAllStringSubmatch(softwareUpdateHTML, -1)
	if len(matches) == 0 {
		t.Fatal("window.html 中未找到任何 t(\"…\") 调用，正则或模板已漂移")
	}

	// stage 由 Go 侧 updater.Stage 常量决定，逐个拼出 t("stages." + stage) 的实际 key。
	keys := make([]string, 0, len(matches)+4)
	for _, m := range matches {
		keys = append(keys, m[1])
	}
	for _, stage := range []updater.Stage{
		updater.StageCheck, updater.StageDownload, updater.StageVerify, updater.StageInstall,
	} {
		keys = append(keys, "stages."+string(stage))
	}

	for _, lang := range []string{"en", "zh", "zh-TW"} {
		seg, ok := parsed[lang]
		if !ok {
			t.Fatalf("dict 缺少 %s 段", lang)
		}
		for _, key := range keys {
			if _, ok := lookupDotted(seg, key); !ok {
				t.Errorf("%s: t(%q) 取不到字符串文案", lang, key)
			}
		}
	}
}

// TestUpdaterWindowTimeoutPrecedesNetwork 锁定 renderError 的分支顺序：Go 的超时错误文本
// 同时含 "timeout"，若 network 分支排在前面就会吞掉它，errors.timeout 永远不可达。
func TestUpdaterWindowTimeoutPrecedesNetwork(t *testing.T) {
	timeoutIdx := strings.Index(softwareUpdateHTML, `t("errors.timeout")`)
	networkIdx := strings.Index(softwareUpdateHTML, `t("errors.networkError")`)
	if timeoutIdx < 0 || networkIdx < 0 {
		t.Fatal("renderError 中未找到 errors.timeout / errors.networkError 分支")
	}
	if timeoutIdx > networkIdx {
		t.Error("errors.timeout 分支排在 errors.networkError 之后，超时会被误报为网络错误")
	}
}

// TestUpdaterBrowserEventContract 锁定「用浏览器下载」按钮的事件名两侧一致。
// 该字符串是 Go 与 window.html 之间的契约，任一侧单独改名都会让按钮静默失效。
func TestUpdaterBrowserEventContract(t *testing.T) {
	if !strings.Contains(softwareUpdateHTML, `Events.Emit("`+eventUserOpenBrowser+`")`) {
		t.Errorf("window.html 未发出事件 %q，Go 侧的监听将永远收不到", eventUserOpenBrowser)
	}
	// 按钮本身也得在错误态可见，否则监听器再对也点不到。
	if !strings.Contains(softwareUpdateHTML, `data-show="error" id="btn-browser"`) {
		t.Error("window.html 缺少错误态可见的 btn-browser 按钮")
	}
}

// TestDownloadPageURL 验证浏览器下载地址的选取：有 release 用其页面，否则退回 latest。
func TestDownloadPageURL(t *testing.T) {
	const relURL = "https://github.com/clip-rss/clip/releases/tag/v9.9.9"
	tests := []struct {
		name string
		rel  *updater.Release
		want string
	}{
		{"无 release（检查阶段就失败）", nil, latestReleaseURL},
		{"有 release 带 htmlURL", &updater.Release{
			Metadata: map[string]any{"github.release.htmlURL": relURL},
		}, relURL},
		{"metadata 为 nil", &updater.Release{}, latestReleaseURL},
		{"htmlURL 为空串", &updater.Release{
			Metadata: map[string]any{"github.release.htmlURL": ""},
		}, latestReleaseURL},
		{"htmlURL 类型不对", &updater.Release{
			Metadata: map[string]any{"github.release.htmlURL": 42},
		}, latestReleaseURL},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			c := &updateController{lastRelease: tc.rel}
			if got := c.downloadPageURL(); got != tc.want {
				t.Errorf("downloadPageURL() = %q，期望 %q", got, tc.want)
			}
		})
	}
}

// TestCleanOrphanedUpdateDirs 验证孤儿更新包清理逻辑。
func TestCleanOrphanedUpdateDirs(t *testing.T) {
	// 创建临时测试目录（模拟系统临时目录）
	testTempDir := t.TempDir()

	now := time.Now()

	// 创建测试用的 wails-update-* 目录
	dirs := []struct {
		name    string
		age     time.Duration
		wantDel bool
	}{
		{"wails-update-newest", 0, false},                 // 最新的，保留
		{"wails-update-recent", 12 * time.Hour, false},    // 12h 内，保留
		{"wails-update-old-1", 25 * time.Hour, true},      // 超过 24h 且非最新，删除
		{"wails-update-old-2", 48 * time.Hour, true},      // 超过 24h 且非最新，删除
		{"not-wails-update", 50 * time.Hour, false},       // 非 wails-update-* 前缀，不处理
		{"wails-update-boundary", 24*time.Hour + 1, true}, // 刚超过 24h，删除
	}

	for _, d := range dirs {
		dirPath := filepath.Join(testTempDir, d.name)
		if err := os.Mkdir(dirPath, 0755); err != nil {
			t.Fatalf("mkdir %s: %v", d.name, err)
		}
		// 设置修改时间
		modTime := now.Add(-d.age)
		if err := os.Chtimes(dirPath, modTime, modTime); err != nil {
			t.Fatalf("chtimes %s: %v", d.name, err)
		}
	}

	// 执行清理
	cleanOrphanedUpdateDirsIn(testTempDir)

	// 验证结果
	for _, d := range dirs {
		dirPath := filepath.Join(testTempDir, d.name)
		_, err := os.Stat(dirPath)
		exists := err == nil

		if d.wantDel && exists {
			t.Errorf("dir %s should be deleted but still exists", d.name)
		}
		if !d.wantDel && !exists {
			t.Errorf("dir %s should be kept but was deleted", d.name)
		}
	}
}

// TestCleanOrphanedUpdateDirs_NoDirectories 验证没有孤儿目录时不报错。
func TestCleanOrphanedUpdateDirs_NoDirectories(t *testing.T) {
	testTempDir := t.TempDir()

	// 不创建任何目录，直接清理
	cleanOrphanedUpdateDirsIn(testTempDir) // 应该不 panic 或报错
}

// TestCleanOrphanedUpdateDirs_OnlyNewest 验证只有 1 个目录时不删除。
func TestCleanOrphanedUpdateDirs_OnlyNewest(t *testing.T) {
	testTempDir := t.TempDir()

	// 创建一个超过 24h 的目录
	oldDir := filepath.Join(testTempDir, "wails-update-old")
	if err := os.Mkdir(oldDir, 0755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	modTime := time.Now().Add(-48 * time.Hour)
	if err := os.Chtimes(oldDir, modTime, modTime); err != nil {
		t.Fatalf("chtimes: %v", err)
	}

	// 执行清理
	cleanOrphanedUpdateDirsIn(testTempDir)

	// 验证：因为只有 1 个目录（是最新的），应该保留
	if _, err := os.Stat(oldDir); os.IsNotExist(err) {
		t.Errorf("the only directory should be kept as newest")
	}
}

// TestMenuBarControllerPreference 验证菜单栏状态机：Ctrl+M 写入用户偏好并持久化；
// F11/专注模式的临时隐藏不动偏好，退出时恢复到偏好而不是无条件显示。
func TestMenuBarControllerPreference(t *testing.T) {
	var saved []bool
	c := newMenuBarController(nil, true, func(v bool) { saved = append(saved, v) })

	// 临时隐藏（F11/专注）不写偏好，恢复后回到用户偏好（可见）。
	c.Set(false)
	if c.visible {
		t.Fatal("Set(false) 后应隐藏")
	}
	c.Restore()
	if !c.visible {
		t.Fatal("Restore 应回到用户偏好（可见）")
	}
	if len(saved) != 0 {
		t.Fatalf("临时隐藏不应写偏好，got %v", saved)
	}

	// Ctrl+M 隐藏并持久化 false。
	c.Toggle()
	if c.visible {
		t.Fatal("Toggle 后应隐藏")
	}
	if len(saved) != 1 || saved[0] {
		t.Fatalf("Toggle 隐藏应持久化 false，got %v", saved)
	}

	// 用户偏好是隐藏时，F11/专注退出的 Restore 不应把菜单显示出来。
	c.Set(false)
	c.Restore()
	if c.visible {
		t.Fatal("用户偏好为隐藏时，Restore 不应显示菜单")
	}

	// 再 Toggle 显示并持久化 true。
	c.Toggle()
	if !c.visible || len(saved) != 2 || !saved[1] {
		t.Fatalf("Toggle 显示应持久化 true，got visible=%v saved=%v", c.visible, saved)
	}
}

// TestMenuBarControllerStartHidden 验证以「用户偏好隐藏」启动时立即收起，
// 且不写入偏好（偏好本来就已是 false）。
func TestMenuBarControllerStartHidden(t *testing.T) {
	var saved []bool
	c := newMenuBarController(nil, false, func(v bool) { saved = append(saved, v) })
	if c.visible {
		t.Fatal("偏好隐藏时启动应为隐藏")
	}
	if len(saved) != 0 {
		t.Fatalf("启动套用偏好不应写回，got %v", saved)
	}

	c.Restore()
	if c.visible {
		t.Fatal("Restore 不应显示菜单")
	}

	c.Toggle()
	if !c.visible || len(saved) != 1 || !saved[0] {
		t.Fatalf("Toggle 应显示并持久化 true，got visible=%v saved=%v", c.visible, saved)
	}
}

// TestMenuI18nParity 验证原生菜单文案三语言齐全，且 menuRoleKeys 引用的每个 key 都有
// 译文。缺失时 label() 会静默回退英文，用户看到「中文界面里夹英文菜单」。
func TestMenuI18nParity(t *testing.T) {
	dict := menuI18nDict()
	en := dict["en"]
	if len(en) == 0 {
		t.Fatal("menu dict 缺少非空 en 段")
	}
	for _, lang := range []string{"zh", "zh-TW"} {
		labels := dict[lang]
		if len(labels) == 0 {
			t.Fatalf("menu dict 缺少非空 %s 段", lang)
		}
		for key := range en {
			if labels[key] == "" {
				t.Errorf("%s 缺少 menu key %q", lang, key)
			}
		}
		for key := range labels {
			if _, ok := en[key]; !ok {
				t.Errorf("%s 多出 menu key %q", lang, key)
			}
		}
	}
	for _, rk := range menuRoleKeys {
		if en[rk.key] == "" {
			t.Errorf("menuRoleKeys 引用了不存在的 key %q", rk.key)
		}
	}
}
