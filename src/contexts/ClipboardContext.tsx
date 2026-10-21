/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import type { IFile } from '../types/files';

interface ClipboardItem {
    files: IFile[];
    operation: 'copy' | 'cut';
}

interface ClipboardContextType {
    clipboard: ClipboardItem | null;
    copy: (files: IFile[]) => void;
    cut: (files: IFile[]) => void;
    clear: () => void;
}

const ClipboardContext = createContext<ClipboardContextType | undefined>(undefined);

export const ClipboardProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [clipboard, setClipboard] = useState<ClipboardItem | null>(null);

  // 剪贴板由主进程持有（跨窗口共享）：
  // 挂载时读取当前值，并订阅其他窗口的变更广播
  useEffect(() => {
    if (!window.electron) return;
    window.electron.clipboardGet().then(setClipboard);
    return window.electron.onClipboardChange((data) => setClipboard(data));
  }, []);

  const copy = (files: IFile[]) => {
    setClipboard({ files, operation: 'copy' });
    window.electron?.clipboardSet({ files, operation: 'copy' });
    // 同时写入系统剪贴板 text/uri-list：外部文件管理器/聊天应用可粘贴
    // 真实文件（图片同样按文件语义）。虚拟路径（objects:// 等）由主进程
    // 过滤（只接受绝对路径），不会写出无效 URI。
    void window.electron?.clipboardWriteFiles(files.map((f) => f.path)).catch(() => {
      /* 平台不支持自定义 MIME：内部剪贴板仍可用 */
    });
  };

  const cut = (files: IFile[]) => {
    setClipboard({ files, operation: 'cut' });
    window.electron?.clipboardSet({ files, operation: 'cut' });
    // 外部剪贴板只表达文件列表；对外表现为复制（内部仍按 cut 移动）
    void window.electron?.clipboardWriteFiles(files.map((f) => f.path)).catch(() => {
      /* 同上 */
    });
  };

  const clear = () => {
    setClipboard(null);
    window.electron?.clipboardClear();
  };

  return (
    <ClipboardContext.Provider value={{ clipboard, copy, cut, clear }}>
      {children}
    </ClipboardContext.Provider>
  );
};

export const useClipboard = () => {
  const context = useContext(ClipboardContext);
  if (!context) {
    throw new Error('useClipboard must be used within a ClipboardProvider');
  }
  return context;
};
