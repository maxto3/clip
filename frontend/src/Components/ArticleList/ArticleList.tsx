import { useEffect, useLayoutEffect, useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useSidebarStore, useArticleStore, useLayoutStore } from '../../Stores'
import { isEditableTarget, useVisibleArticles } from '../../Hooks'
import { onItemsUpdated } from '../../Utils'
import ListHeader from './ListHeader'
import ArticleRow from './ArticleRow'
import EmptyState from './EmptyState'
import ArticleListSkeleton from './ArticleListSkeleton'
import styles from './ArticleList.module.scss'

const ROW_HEIGHT = 88

function ArticleList(): JSX.Element {
  const selection = useSidebarStore((s) => s.selection)
  const feeds = useSidebarStore((s) => s.feeds)

  const loading = useArticleStore((s) => s.loading)
  const filter = useArticleStore((s) => s.filter)
  const sort = useArticleStore((s) => s.sort)
  const selectedItemId = useArticleStore((s) => s.selectedItemId)
  const load = useArticleStore((s) => s.load)
  const reload = useArticleStore((s) => s.reload)
  const setFilter = useArticleStore((s) => s.setFilter)
  const setSort = useArticleStore((s) => s.setSort)
  const selectItem = useArticleStore((s) => s.selectItem)
  const toggleStar = useArticleStore((s) => s.toggleStar)
  const markAllRead = useArticleStore((s) => s.markAllRead)
  const batchStar = useArticleStore((s) => s.batchStar)
  const searchActive = useArticleStore((s) => s.searchActive)
  const searchQuery = useArticleStore((s) => s.searchQuery)
  const searching = useArticleStore((s) => s.searching)
  const clearSearch = useArticleStore((s) => s.clearSearch)

  // 选中范围变化 → 退出搜索并重新加载该范围
  useEffect(() => {
    clearSearch()
    load(selection)
  }, [selection, load, clearSearch])

  // 新文章事件 → 重新拉取当前范围
  useEffect(() => {
    const off = onItemsUpdated(() => reload())
    return off
  }, [reload])

  const feedTitle = useMemo(() => {
    const map = new Map<number, string>()
    for (const f of feeds) map.set(f.id, f.title)
    return map
  }, [feeds])

  const visibleItems = useVisibleArticles()

  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: visibleItems.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  })

  // J/K 切换文章后把列表对齐到新选中行：行没完整落在可视区内（含底部只露出半行）
  // 就滚到顶部，否则阅读区已换文、列表却停在原处，看不到当前文章。
  // 用 ref 只在「选中真正变化」时响应：刷新/筛选导致的列表重建不触发，避免无谓跳动。
  const lastAutoScrolledIdRef = useRef<number | null>(null)
  useLayoutEffect(() => {
    if (selectedItemId === lastAutoScrolledIdRef.current) return
    lastAutoScrolledIdRef.current = selectedItemId
    if (selectedItemId === null) return
    const el = scrollRef.current
    if (!el) return
    const index = visibleItems.findIndex((it) => it.id === selectedItemId)
    if (index === -1) return

    const top = index * ROW_HEIGHT
    if (
      top < el.scrollTop ||
      top + ROW_HEIGHT > el.scrollTop + el.clientHeight
    ) {
      virtualizer.scrollToIndex(index, { align: 'start' })
    }

    // 键盘导航后把 DOM 焦点同步到新选中行（点击切换时焦点本来就在行上，重复聚焦无害）：
    // 否则焦点残留在旧行，回车会在旧行上误触发选中。
    // 正在输入时不抢焦点；专注模式覆盖层是 aria-modal，不往背景列表里塞焦点。
    if (useLayoutStore.getState().focusMode) return
    if (isEditableTarget(document.activeElement)) return
    let attempts = 0
    const tryFocus = (): void => {
      const row = el.querySelector<HTMLElement>(
        '[role="option"][aria-selected="true"]',
      )
      if (row) {
        row.focus({ preventScroll: true })
        return
      }
      // 目标行可能刚翻页、还没进虚拟列表的渲染范围，最多再等几帧。
      if (attempts++ < 3) requestAnimationFrame(tryFocus)
    }
    tryFocus()
  }, [selectedItemId, visibleItems, virtualizer])

  function handleMarkAllRead(): void {
    markAllRead(visibleItems.filter((it) => !it.isRead).map((it) => it.id))
  }

  function handleBatchStar(): void {
    batchStar(visibleItems.filter((it) => !it.isStarred).map((it) => it.id))
  }

  const busy = loading || (searchActive && searching)
  const showEmpty = !busy && visibleItems.length === 0
  const showSkeleton = busy && visibleItems.length === 0

  return (
    <div className={styles.list}>
      <ListHeader
        filter={filter}
        sort={sort}
        onFilterChange={setFilter}
        onSortChange={setSort}
        onMarkAllRead={handleMarkAllRead}
        onBatchStar={handleBatchStar}
        searchActive={searchActive}
        resultCount={visibleItems.length}
      />

      {showSkeleton ? (
        <ArticleListSkeleton />
      ) : showEmpty ? (
        <EmptyState
          filter={filter}
          searchQuery={searchActive ? searchQuery : undefined}
        />
      ) : (
        <div
          ref={scrollRef}
          className={styles.scroll}
          role="listbox"
          aria-label="文章列表"
        >
          <div
            className={styles.virtualInner}
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((row) => {
              const item = visibleItems[row.index]
              return (
                <div
                  key={item.id}
                  className={styles.virtualRow}
                  style={{
                    height: row.size,
                    transform: `translateY(${row.start}px)`,
                  }}
                >
                  <ArticleRow
                    item={item}
                    sourceName={feedTitle.get(item.feedId) ?? ''}
                    selected={item.id === selectedItemId}
                    onSelect={selectItem}
                    onToggleStar={toggleStar}
                    query={searchActive ? searchQuery : undefined}
                  />
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

export default ArticleList
