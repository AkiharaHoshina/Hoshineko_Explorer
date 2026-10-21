import React from 'react';
import { ToastContainer } from 'react-toastify';
import { DragProvider } from '../../contexts/DragContext';
import { useUiZoom } from '../../hooks/useUiZoom';
import { FilePicker } from '../FilePicker';

/**
 * 文件选择器窗口根组件：DragProvider + ToastContainer + 界面缩放。
 * 由 main.tsx 在 `?mode=picker` 时挂载（普通窗口挂载 App 主界面）。
 *
 * 与选择器主体（FilePicker.tsx）分离：根组件只负责窗口级 provider 与
 * 主题/缩放接线；选择器主体与保存模式仍在 FilePicker.tsx，后续按
 * docs/代码拆分可行性报告.md 的 hook 拆分继续收敛。
 */
export const FilePickerRoot: React.FC = () => {
  useUiZoom();
  return (
    <DragProvider>
      <FilePicker />
      <ToastContainer
        position="bottom-right"
        autoClose={5000}
        hideProgressBar={false}
        newestOnTop={false}
        closeOnClick
        pauseOnHover
        theme="dark"
        limit={5}
        style={{ zIndex: 2000 }}
      />
    </DragProvider>
  );
};
