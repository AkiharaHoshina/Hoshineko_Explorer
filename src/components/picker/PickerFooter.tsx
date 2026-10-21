import React from 'react';
import { Button } from '../Button';
import { OutlinedSelect, SelectOption, OutlinedTextField } from '../md';
import { t } from '../../i18n';
import type { PickerFilter } from '../../types/picker';

interface PickerFooterProps {
  /** 保存模式：文件名输入框 + 确认文案替换选择语义 */
  isSave: boolean;
  /** 已选条目数（选择模式左下角提示，0 不显示） */
  selectedCount: number;
  /** 保存模式文件名（受控） */
  fileName: string;
  /** 文件名输入（过滤 `/`、控制字符并截断 255） */
  onFileNameChange: (e: Event) => void;
  /** 文件名输入框回车 = 确认 */
  onFileNameKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void;
  /** 当前生效过滤器 id（null = 所有文件） */
  activeFilterId: string | null;
  onFilterChange: (id: string) => void;
  filterLabel: (filter: PickerFilter) => string;
  /** 调用方声明的过滤器；未声明时只有「所有文件」 */
  filters?: PickerFilter[];
  /** 保存请求方自定义的确认按钮文案 */
  acceptLabel?: string;
  /** 确认按钮可用态 */
  canConfirm: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * 选择器/保存器底栏：左下角已选数量（选择模式）、文件类型过滤下拉
 * （保存模式换成文件名输入框）、取消/确认按钮。
 *
 * 从 FilePicker.tsx 抽出——底栏只消费 props，不持有选择器状态。
 */
export const PickerFooter: React.FC<PickerFooterProps> = ({
  isSave,
  selectedCount,
  fileName,
  onFileNameChange,
  onFileNameKeyDown,
  activeFilterId,
  onFilterChange,
  filterLabel,
  filters,
  acceptLabel,
  canConfirm,
  onCancel,
  onConfirm,
}) => (
  <footer className="picker-footer">
    {/* 左下角目录显示已删除（用户定案）——选择模式仅在有选中时显示
        已选数量；保存模式的目标绝对路径由文件名输入框承载 */}
    {!isSave && selectedCount > 0 && (
      <span className="picker-hint">
        {t('picker.selected_count', selectedCount)}
      </span>
    )}
    {/* 文件类型过滤：常驻显示——未声明 filters 时仅「所有文件」一项。
        保存模式：换成同样大小的文件名输入框（portal 保存语义）。 */}
    {isSave ? (
      <OutlinedTextField
        className="picker-filter-select"
        label={t('picker.file_name')}
        value={fileName}
        onInput={onFileNameChange}
        onKeyDown={onFileNameKeyDown}
      />
    ) : (
      <OutlinedSelect
        className="picker-filter-select"
        value={activeFilterId ?? ''}
        onInput={(e) => onFilterChange((e.target as HTMLSelectElement).value)}
      >
        <SelectOption value="">
          <div slot="headline">{t('picker.all_files')}</div>
        </SelectOption>
        {filters?.map((f) => (
          <SelectOption key={f.id} value={f.id}>
            <div slot="headline">{filterLabel(f)}</div>
          </SelectOption>
        ))}
      </OutlinedSelect>
    )}
    <Button variant="text" onClick={onCancel}>{t('picker.cancel')}</Button>
    <Button variant="filled" disabled={!canConfirm} onClick={onConfirm}>
      {isSave ? (acceptLabel || t('picker.confirm')) : t('picker.select')}
    </Button>
  </footer>
);
