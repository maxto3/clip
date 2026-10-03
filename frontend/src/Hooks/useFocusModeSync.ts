import { useEffect } from 'react'
import { SystemService } from '../Utils/Api'
import { useLayoutStore } from '../Stores/LayoutStore'

/**
 * 把专注模式状态同步给 Go：进入专注模式时隐藏原生菜单栏，退出时恢复。
 *
 * 前端 chrome（侧栏/列表/工具栏）由 CSS 隐藏，原生菜单栏只存在于 GTK/系统层，
 * 只能由 Go 侧操作。后端调用失败时静默忽略（浏览器预览或应用退出过程中绑定
 * 可能不可用），与 useOnlineStatus 同一容错策略。
 */
export function useFocusModeSync(): void {
  const focusMode = useLayoutStore((s) => s.focusMode)

  useEffect(() => {
    SystemService.SetFocusMode(focusMode).catch(() => {
      // UI 状态不依赖后端调用成功。
    })
  }, [focusMode])
}
