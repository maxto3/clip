import { useMemo } from 'react'
import { useArticleStore, useLayoutStore, useSidebarStore } from '../Stores'
import { buildFeedTree, feedAncestorIds, flattenFeedIds } from '../Utils'
import { useArticleNavigation } from './useArticles'
import { type Hotkey, useHotkeys } from './useHotkeys'

interface AppHotkeyActions {
  /** 打开「添加订阅」弹窗（App 持有弹窗状态）。 */
  onAddFeed: () => void
  /** 打开设置面板（App 持有弹窗状态）。 */
  onOpenSettings: () => void
}

/** 焦点是否落在交互元素上——此时应保留空格/回车的默认行为（如激活按钮）。 */
function isInteractive(el: Element | null): boolean {
  if (!el) return false
  const tag = el.tagName
  if (
    tag === 'BUTTON' ||
    tag === 'A' ||
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT'
  ) {
    return true
  }
  if (el.getAttribute('role') === 'button') return true
  return (el as HTMLElement).isContentEditable === true
}

/** 翻动当前可见阅读区（dir=1 向下，dir=-1 向上）。专注模式优先其覆盖层。 */
function pageReader(dir: 1 | -1): void {
  const inFocus = useLayoutStore.getState().focusMode
  const selector = inFocus
    ? '[data-reader-scroll="focus"]'
    : '[data-reader-scroll="main"]'
  const el = document.querySelector(selector) as HTMLElement | null
  if (!el) return
  const step = Math.max(el.clientHeight - 60, 100)
  el.scrollBy({ top: dir * step, behavior: 'smooth' })
}

/**
 * Ctrl+J/K：按侧栏显示顺序切换到下一个/上一个订阅源，普通与专注模式都可用。
 *
 * 顺序由 flattenFeedIds 给出（与侧栏渲染一致）；切换后展开其祖先分类，保证选中项
 * 在侧栏可见。专注模式下额外请求「加载完成后选中第一篇」，否则旧文章已不在新源的
 * 列表里，阅读区会停在空状态。
 */
function switchFeed(dir: 1 | -1): void {
  const sidebar = useSidebarStore.getState()
  const tree = buildFeedTree(sidebar.categories, sidebar.feeds, sidebar.feedSort)
  const ids = flattenFeedIds(tree)
  if (ids.length === 0) return

  const current = sidebar.selection.kind === 'feed' ? sidebar.selection.id : null
  let index: number
  if (current === null) {
    index = dir > 0 ? 0 : ids.length - 1
  } else {
    const i = ids.indexOf(current)
    index = i === -1 ? (dir > 0 ? 0 : ids.length - 1) : i + dir
  }
  if (index < 0 || index >= ids.length) return

  const feedId = ids[index]
  for (const categoryId of feedAncestorIds(
    sidebar.categories,
    sidebar.feeds.find((f) => f.id === feedId),
  )) {
    if (!sidebar.expanded.has(categoryId)) sidebar.toggleExpand(categoryId)
  }
  sidebar.select({ kind: 'feed', id: feedId })
  if (useLayoutStore.getState().focusMode) {
    useArticleStore.getState().requestFirstSelection()
  }
}

/**
 * 注册应用全部全局快捷键。在 App 顶层挂载一次。
 *
 * 覆盖：添加订阅、刷新、阅读区翻页、筛选切换、聚焦搜索、上一篇/下一篇、上/下一个订阅源。
 * `J/K` 在非专注模式下由此处处理；专注模式下让位给 FocusMode（它还负责
 * `↑/↓`、灯箱等），避免同一次按键触发两次导航。`Esc` 由 Radix/FocusMode 处理。
 */
export function useAppHotkeys(actions: AppHotkeyActions): void {
  const { onAddFeed, onOpenSettings } = actions
  const nav = useArticleNavigation()

  const bindings = useMemo<Hotkey[]>(() => {
    // 专注模式自管 J/K（含 Shift 大小写与 ↑/↓），这里直接让位。
    const navInNormalMode = (handler: () => void) => (e: KeyboardEvent) => {
      if (useLayoutStore.getState().focusMode) return
      e.preventDefault()
      handler()
    }

    return [
      {
        combo: 'mod+n',
        handler: (e) => {
          e.preventDefault()
          onAddFeed()
        },
      },
      {
        combo: 'mod+,',
        handler: (e) => {
          e.preventDefault()
          onOpenSettings()
        },
      },
      {
        combo: 'mod+shift+f',
        handler: (e) => {
          e.preventDefault()
          const inFocus = useLayoutStore.getState().focusMode
          const hasItem = useArticleStore.getState().selectedItemId !== null
          if (inFocus || hasItem) useLayoutStore.getState().toggleFocus()
        },
      },
      {
        combo: 'mod+1',
        handler: (e) => {
          e.preventDefault()
          useArticleStore.getState().setFilter('all')
        },
      },
      {
        combo: 'mod+2',
        handler: (e) => {
          e.preventDefault()
          useArticleStore.getState().setFilter('unread')
        },
      },
      {
        combo: 'mod+3',
        handler: (e) => {
          e.preventDefault()
          useArticleStore.getState().setFilter('starred')
        },
      },
      {
        combo: 'r',
        handler: (e) => {
          e.preventDefault()
          void useSidebarStore.getState().refreshSelected()
        },
      },
      {
        combo: 'shift+r',
        handler: (e) => {
          e.preventDefault()
          void useSidebarStore.getState().forceRefreshAll()
        },
      },
      // 上一/下一篇（普通模式）。Shift 变体对应大写 J/K，与专注模式行为对齐。
      {
        combo: 'j',
        handler: navInNormalMode(nav.goNext),
      },
      {
        combo: 'shift+j',
        handler: navInNormalMode(nav.goNext),
      },
      {
        combo: 'k',
        handler: navInNormalMode(nav.goPrev),
      },
      {
        combo: 'shift+k',
        handler: navInNormalMode(nav.goPrev),
      },
      // 上/下一个订阅源：两种模式都可用，不做专注模式让位。
      {
        combo: 'mod+j',
        handler: (e) => {
          e.preventDefault()
          switchFeed(1)
        },
      },
      {
        combo: 'mod+k',
        handler: (e) => {
          e.preventDefault()
          switchFeed(-1)
        },
      },
      {
        combo: '/',
        handler: (e) => {
          e.preventDefault()
          const input = document.getElementById(
            'toolbar-search',
          ) as HTMLInputElement | null
          input?.focus()
        },
      },
      {
        combo: 'space',
        handler: (e) => {
          if (isInteractive(document.activeElement)) return // 保留按钮等的空格默认行为
          e.preventDefault()
          pageReader(1)
        },
      },
      {
        combo: 'shift+space',
        handler: (e) => {
          if (isInteractive(document.activeElement)) return
          e.preventDefault()
          pageReader(-1)
        },
      },
    ]
  }, [onAddFeed, onOpenSettings, nav])

  useHotkeys(bindings)
}
