import { useState, useCallback, useRef } from 'react';
import { t } from '../i18n';

interface TabState {
  id: string;
  title: string;
  path: string;
  version: number;
  pendingSelectFile?: string;
}

export function useTabs() {
  const [tabs, setTabs] = useState<TabState[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>("");
  /** tabs 最新值引用：回调里读它来避免「在 setTabs updater 内再 setState」
   *  （v3.0.1040：该写法在 React 19 并发渲染下可能丢失——新窗口带启动路径
   *  打开时表现为「标签页已创建但不激活、内容空白」的历史症状） */
  const tabsRef = useRef(tabs);
  // eslint-disable-next-line react-hooks/refs -- 渲染期同步 ref 供稳定回调读取
  tabsRef.current = tabs;

  const handleAddTab = useCallback((path?: string) => {
    const newTabId = Date.now().toString();
    const currentPath = path || "/";
    const newTab: TabState = {
      id: newTabId,
      title: "New Tab",
      path: currentPath,
      version: 0,
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTabId);
  }, []);

  const handleCloseTab = useCallback((id: string) => {
    // 与 handleSidebarNavigate 同因：activeTabId 在 updater 外决定
    const newTabs = tabsRef.current.filter((t) => t.id !== id);
    setTabs(newTabs);
    setActiveTabId(newTabs.length > 0 ? newTabs[newTabs.length - 1].id : "");
  }, []);

  const handleTabPathUpdate = useCallback((id: string, path: string) => {
    // 虚拟路径（仪表板/回收站/搜索态）整串作为标题，由 TabBar 的
    // getTabTitle 翻译显示（search:// 解析关键词后显示「搜索: …」）
    const folderName = path === 'app://dashboard' || path === 'trash://' || path.startsWith('search://') || path.startsWith('objects://') || path.startsWith('objectsearch://') || path.startsWith('settings://') || path.startsWith('settingssearch://')
      ? path
      : path.split("/").pop() || path;
    setTabs((prev) => {
      // Skip update if path and title are unchanged to avoid cascading re-renders
      const existing = prev.find((t) => t.id === id);
      if (existing && existing.path === path && existing.title === folderName) {
        return prev;
      }
      return prev.map((t) => {
        if (t.id === id) return { ...t, path, title: folderName };
        return t;
      });
    });
  }, []);

  const handleSidebarNavigate = useCallback(
    (path: string, selectFileName?: string) => {
      const prev = tabsRef.current;
      if (prev.length === 0) {
        // 首个标签页：id/激活状态在 setTabs 之外决定（见 tabsRef 注释）
        const newTabId = Date.now().toString();
        const newTab: TabState = {
          id: newTabId,
          title: t("tab.new_tab"),
          path,
          version: 0,
          pendingSelectFile: selectFileName,
        };
        setTabs([newTab]);
        setActiveTabId(newTabId);
        return;
      }
      setTabs((cur) => cur.map((tab) => (
        tab.id === activeTabId ? { ...tab, path, pendingSelectFile: selectFileName } : tab
      )));
    },
    [activeTabId],
  );

  const handleScrollToComplete = useCallback(() => {
    setTabs((prev) =>
      prev.map((t) => (t.id === activeTabId ? { ...t, pendingSelectFile: undefined } : t)),
    );
  }, [activeTabId]);

  const refreshActiveTab = useCallback(() => {
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTabId ? { ...t, version: t.version + 1 } : t,
      ),
    );
  }, [activeTabId]);

  const currentPath = tabs.find((t) => t.id === activeTabId)?.path || "";

  return {
    tabs,
    setTabs,
    activeTabId,
    setActiveTabId,
    currentPath,
    handleAddTab,
    handleCloseTab,
    handleTabPathUpdate,
    handleSidebarNavigate,
    handleScrollToComplete,
    refreshActiveTab,
  };
}
