import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react-dom/test-utils'
import { createRoot, type Root } from 'react-dom/client'
import '../../I18n'
import { useAppHotkeys } from '../../Hooks/useAppHotkeys'
import {
  useArticleStore,
  useLayoutStore,
  useReaderStore,
  useSidebarStore,
} from '../../Stores'
import type { Item } from '../../Types'
import FocusMode from './FocusMode'

// Stores barrel 在模块加载期会解析主题偏好，jsdom 没有 matchMedia，须在 import 前补上；
// 同时挡掉 Wails runtime 在浏览器环境的绑定调用（否则会去 fetch localhost 并抛未处理拒绝）。
vi.hoisted(() => {
  window.matchMedia = ((query: string) => ({
    media: query,
    matches: false,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response('null', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )) as typeof fetch
})

// 专注模式覆盖层里的平台探测走 Wails 绑定，测试环境直接桩掉。
vi.mock('../../Hooks/usePlatform', () => ({
  usePlatform: () => 'windows',
}))

// jsdom 不实现 scrollBy，用 spy 记录「滚动正文」的调用。
const scrollBySpy = vi.fn()

function makeItem(id: number, hoursAgo: number): Item {
  return {
    id,
    feedId: 1,
    title: `文章 ${id}`,
    url: `https://example.com/${id}`,
    summary: '',
    content: `<p>正文 ${id}</p>`,
    fullContent: `<p>全文 ${id}</p>`,
    author: '',
    categories: '',
    publishedAt: new Date(Date.now() - hoursAgo * 3600_000).toISOString(),
    isRead: true,
    isStarred: false,
    note: '',
  } as unknown as Item
}

/** 与 App 顶层组合一致：全局快捷键 + 专注模式覆盖层同挂载。 */
function Harness(): JSX.Element {
  useAppHotkeys({ onAddFeed: () => {}, onOpenSettings: () => {} })
  return <FocusMode />
}

function press(key: string): void {
  act(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key }))
  })
}

describe('FocusMode 键盘行为', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    ;(
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
    Object.defineProperty(HTMLElement.prototype, 'scrollBy', {
      configurable: true,
      value: scrollBySpy,
    })
    scrollBySpy.mockClear()

    // timeDesc 排序：[新, 旧]；选中第一篇时下一篇是第二篇。
    const first = makeItem(1, 1)
    const second = makeItem(2, 2)
    useArticleStore.setState({
      items: [first, second],
      filter: 'all',
      sort: 'timeDesc',
      selectedItemId: first.id,
      searchActive: false,
      searchResults: [],
      showSummary: false,
      loading: false,
    })
    useSidebarStore.setState({
      feeds: [],
      categories: [],
      selection: { kind: 'all' },
    })
    useLayoutStore.setState({ focusMode: true, notePanelOpen: false })
    // 一行 = fontSize × lineHeight = 16 × 2 = 32px。
    useReaderStore.setState({ fontSize: 16, lineHeight: 2 })

    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  it('↑/↓ 只按行滚动当前正文，不切换上一篇/下一篇', async () => {
    await act(async () => {
      root.render(<Harness />)
    })
    expect(useArticleStore.getState().selectedItemId).toBe(1)

    press('ArrowDown')
    expect(useArticleStore.getState().selectedItemId).toBe(1)
    expect(scrollBySpy).toHaveBeenLastCalledWith({ top: 32 })

    press('ArrowUp')
    expect(useArticleStore.getState().selectedItemId).toBe(1)
    expect(scrollBySpy).toHaveBeenLastCalledWith({ top: -32 })
  })

  it('J/K 仍然切换上一篇/下一篇', async () => {
    await act(async () => {
      root.render(<Harness />)
    })

    press('j')
    expect(useArticleStore.getState().selectedItemId).toBe(2)

    press('k')
    expect(useArticleStore.getState().selectedItemId).toBe(1)
  })
})
