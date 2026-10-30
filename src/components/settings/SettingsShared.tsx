import React, { useEffect, useRef } from 'react';
import type { MdSwitch as MdSwitchElement } from '@material/web/switch/switch.js';
import { Icon } from '../Icon';
import { Button } from '../Button';
import { Checkbox, OutlinedSelect, SelectOption, Switch } from '../md';
import { t } from '../../i18n';

/**
 * 设置页共享行组件（review 26）：沿用旧 SettingsDialog 的行结构
 * （.settings-row/.settings-section——样式从 SettingsDialog.css 迁入
 * SettingsPage.css），全部**立即生效**（无 pending 草稿）。
 */

/** 分区标题（旧 .settings-section-header 语义）
 *  rowId：设置搜索深链接锚点（整段分区挂 data-settings-row） */
export const SettingsSection: React.FC<{ title: string; rowId?: string; children: React.ReactNode }> = ({ title, rowId, children }) => (
  <div className="settings-section" data-settings-row={rowId}>
    <div className="settings-section-header">{title}</div>
    {children}
  </div>
);

interface SettingsRowProps {
  icon?: string;
  /** 图标实心态（favorite 等） */
  iconFilled?: boolean;
  label: React.ReactNode;
  /** 副标题（可换行） */
  sub?: React.ReactNode;
  /**
   * 设置搜索索引行 id（settingsSearchIndex 的 rowId 同值——两处登记
   * 约定）：挂在 data-settings-row 上，搜索命中点击深链接
   * （settings://<cat>?focus=<rowId>）滚动高亮定位用。
   */
  rowId?: string;
  /** 整行点击（开关行用；按钮行右侧按钮自带 onClick） */
  onClick?: () => void;
  /** 无原生控件的行（色点/导航行）键盘激活用 */
  onKeyDown?: (e: React.KeyboardEvent<HTMLElement>) => void;
  role?: 'button' | undefined;
  tabIndex?: number;
  children?: React.ReactNode;
}

/** 通用设置行：左侧图标 + 标签（+副标题），右侧任意控件 */
export const SettingsRow: React.FC<SettingsRowProps> = ({
  icon, iconFilled, label, sub, rowId, onClick, onKeyDown, role, tabIndex, children,
}) => (
  <div className="settings-row" data-settings-row={rowId} onClick={onClick} onKeyDown={onKeyDown} role={role} tabIndex={tabIndex}>
    <div className="settings-row__start">
      {icon && <Icon name={icon} filled={iconFilled} />}
      <div className="settings-row__label-col">
        <div className="settings-row__label">{label}</div>
        {sub != null && <div className="settings-row__sub settings-row__sub--wrap">{sub}</div>}
      </div>
    </div>
    {children}
  </div>
);

interface SettingsCheckboxGroupRowProps {
  icon?: string;
  label: React.ReactNode;
  /** 副标题（可换行说明） */
  sub?: React.ReactNode;
  /** 设置搜索索引行 id */
  rowId?: string;
  /** 已勾选的值集合 */
  value: string[];
  /** 勾选变化（返回新的值集合；允许清空 = 两项都不显示） */
  onChange: (v: string[]) => void;
  /** 可选项（顺序即渲染顺序） */
  options: Array<{ value: string; label: string }>;
}

/** 多选设置行（v3.0.1040）：右侧一组 md-checkbox 选项。
 *  md-checkbox 纯展示（pointer-events:none + aria-hidden），交互由外层
 *  role=checkbox 容器接管（与 OpenWithDialog 的同款模式），键盘 Space/Enter
 *  可切换。 */
export const SettingsCheckboxGroupRow: React.FC<SettingsCheckboxGroupRowProps> = ({
  icon, label, sub, rowId, value, onChange, options,
}) => (
  <SettingsRow icon={icon} label={label} sub={sub} rowId={rowId}>
    <div className="settings-checkbox-group">
      {options.map((o) => {
        const checked = value.includes(o.value);
        const toggle = () => {
          onChange(checked
            ? value.filter((v) => v !== o.value)
            : [...value, o.value]);
        };
        return (
          <div
            key={o.value}
            className="settings-checkbox-option"
            role="checkbox"
            aria-checked={checked}
            tabIndex={0}
            onClick={toggle}
            onKeyDown={(e) => {
              if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                toggle();
              }
            }}
          >
            <Checkbox
              checked={checked}
              tabIndex={-1}
              style={{ pointerEvents: 'none' }}
              aria-hidden="true"
            />
            <span>{o.label}</span>
          </div>
        );
      })}
    </div>
  </SettingsRow>
);

interface SettingsSelectRowProps {
  icon?: string;
  label: string;
  sub?: React.ReactNode;
  /** 设置搜索索引行 id（SettingsRow.rowId 透传——两处登记约定） */
  rowId?: string;
  /** 当前值（受控） */
  value: string;
  /** 选项：value 与 onChange 回传同值 */
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}

/** 下拉选择行（右侧 md-outlined-select，立即生效） */
export const SettingsSelectRow: React.FC<SettingsSelectRowProps> = ({
  icon, label, sub, rowId, value, options, onChange,
}) => (
  <SettingsRow icon={icon} label={label} sub={sub} rowId={rowId}>
    <OutlinedSelect
      className="settings-select"
      value={value}
      onInput={(e) => onChange((e.target as HTMLSelectElement).value)}
    >
      {options.map((o) => (
        <SelectOption key={o.value} value={o.value}>
          <div slot="headline">{o.label}</div>
        </SelectOption>
      ))}
    </OutlinedSelect>
  </SettingsRow>
);

interface SettingsSwitchRowProps {
  icon?: string;
  label: string;
  sub?: React.ReactNode;
  /** 设置搜索索引行 id（SettingsRow.rowId 透传——两处登记约定） */
  rowId?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}

/** 双态开关行：整行点击切换（立即生效） */
export const SettingsSwitchRow: React.FC<SettingsSwitchRowProps> = ({ icon, label, sub, rowId, value, onChange }) => (
  <SettingsRow
    icon={icon}
    label={label}
    sub={sub}
    rowId={rowId}
    onClick={() => onChange(!value)}
  >
    <Switch selected={value} onClick={() => onChange(!value)} />
  </SettingsRow>
);

interface ThreeStateSwitchRowProps {
  icon?: string;
  label: string;
  /** 设置搜索索引行 id（SettingsRow.rowId 透传——两处登记约定） */
  rowId?: string;
  /** null = 跟随系统（显示生效值）、true/false = 手动 */
  value: boolean | null;
  /** 跟随系统时的生效值（检测结果） */
  effective: boolean;
  /** 跟随系统副标题（检测来源说明） */
  followSub?: string;
  onChange: (v: boolean | null) => void;
}

/**
 * 三态开关行（跟随系统 / 开 / 关；标题栏与明暗主题同款，用户约定语义）：
 * - 跟随系统模式下点开关：退出跟随 + 新值 = 生效值的反；
 * - 手动模式下点开关：取反；
 * - 「跟随系统」按钮：进入跟随模式。
 * 实现要点：md-switch 纯展示化（CSS pointer-events none + 内部 input 移出
 * Tab 序），交互由外层 role="switch" 容器接管——md-switch 内部 checkbox
 * 状态机与 React 受控赋值有竞争（跟随模式「点两次才生效」的根源），
 * 见 docs/跟随系统设置项目逻辑.md。
 */
export const ThreeStateSwitchRow: React.FC<ThreeStateSwitchRowProps> = ({
  icon, label, rowId, value, effective, followSub, onChange,
}) => {
  const switchRef = useRef<MdSwitchElement | null>(null);
  useEffect(() => {
    const input = switchRef.current?.shadowRoot?.querySelector('input') as HTMLInputElement | null | undefined;
    if (input && input.tabIndex !== -1) input.tabIndex = -1;
  });
  const toggle = () => {
    onChange(value === null ? !effective : !value);
  };
  return (
    <div className="settings-row" data-settings-row={rowId}>
      <div className="settings-row__start">
        {icon && <Icon name={icon} />}
        <div className="settings-row__label-col">
          <div className="settings-row__label">{label}</div>
          {value === null && followSub != null && (
            <div className="settings-row__sub">{followSub}</div>
          )}
        </div>
      </div>
      <Button
        variant="text"
        disabled={value === null}
        onClick={() => onChange(null)}
      >
        {t('theme.follow_system')}
      </Button>
      <div
        className="settings-titlebar-switch-area"
        role="switch"
        aria-checked={effective}
        tabIndex={0}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === ' ' || e.key === 'Enter') {
            e.preventDefault();
            toggle();
          }
        }}
      >
        <Switch ref={switchRef} selected={effective} />
      </div>
    </div>
  );
};
