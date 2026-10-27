# xdg-desktop-portal FileChooser 后端

Hoshineko 的内置文件选择器可作为 **xdg-desktop-portal 的 FileChooser 后端**使用：
外部程序（GTK/Qt 应用等）经 portal 请求文件选择对话框时，由 Hoshineko 的选择器窗口响应。
后端把 portal 请求翻译成与内部 `picker:open` 完全相同的 `PickerConfig`（模式 + 类型过滤器），
**一条实现、两条入口**（内部 IPC / 外部 D-Bus）。

## 支持的选项（portal → 本后端）

| portal 选项 | 映射 |
| --- | --- |
| `directory` | `true` → folder 模式 |
| `multiple` | `true` → files 模式 |
| `filters`（`a(sa(us))`） | 每项 `(名称, (类型, 模式) 对数组)`：类型 0 glob（`*.docx`）→ extensions；类型 1 MIME（`image/*`）→ mimes；**过滤器 id = portal 侧名称**；显示名由描述体系按首扩展名生成（portal 过滤器无标签） |
| `current_filter`（`(sa(us))`） | 按名称与 filters 匹配 → `defaultFilterId` |
| `handle_token` | 请求对象路径（按 portal 传入的 handle 路径导出 Request） |

**SaveFile（保存对话框，v0.11.24 起）**：

| portal 选项 | 映射 |
| --- | --- |
| `current_name`（`s`） | 默认文件名（预填文件名输入框） |
| `current_file`（`ay`） | 编辑已有文件：字节数组 UTF-8 解码为默认文件名，优先级高于 `current_name` |
| `current_folder`（`ay`） | 初始目录（字节数组 UTF-8 解码；非目录时回退家目录） |
| `accept_label`（`s`） | 确定按钮文案（缺省 = i18n「确定」） |

保存模式界面：显示全部文件与目录，底部「文件类型」下拉换成等宽的文件名输入框；点文件 = 填名、双击文件 = 填名并确定、目录双击进入；确定返回 `file://<当前目录>/<文件名>`。**重名冲突确认（v0.11.33 起）**：目标名与当前目录现有条目重名时，先弹与复制/移动同款的冲突对话框——覆盖（按原名回传）/ 自动重命名（回传安全名 `A_2` 等，列表显示「原名 → 新名」预览）/ 手动重命名（逐项编辑 + 实时校验），取消只关弹窗留在选择器；调用方拿到的 URI 即为最终落盘名。

选择器/保存器窗口的侧边栏同样显示 GUI 里固定的目录（v0.11.31 起）：常驻进程的 userData 与 GUI 隔离、读不到 GUI 的 localStorage，主进程创建窗口时从 GUI userData 下的 `sidebar-pinned.json` 快照注入（GUI 每次改动固定项即原子落盘，常驻进程现读现用，无需重启）。

结果按 portal 约定回传 `file://` URI（`uris`）+ `choices`。

## 限制（v1）

- `SaveFiles`（多文件保存）返回 NotSupported 错误（`SaveFile` 单文件保存已支持）。
- 保存模式**只返回 URI、不创建文件**（文件由调用方写入，Firefox/Electron/GTK 调用方均自行写入）；重名冲突由保存器自身弹窗确认（v0.11.33 起，见上）。
- 保存模式不应用 `filters`（文件名输入框取代类型下拉，需手输完整文件名）。
- 应用运行时注册总线名并响应；应用未运行时可选安装 D-Bus 服务激活文件（见下）。

## 后端冲突诊断与恢复（v0.11.33 起）

- **冲突探测**：portal / FileManager1 后端对象暴露只读 `Version` 属性；注册总线名失败时探测占名者版本——`outdated`（旧版常驻，建议卸载重装系统集成）/ `noVersion`（更旧构建）/ `unresponsive`（僵尸占名：进程已死但总线连接未释放）/ `sameVersion`（同版本另一实例，正常）。
- **提示**：冲突以带遮罩的警告弹窗提示（每次会话一次），详情常驻设置页「系统集成」行副标题。**版本不一致时抑制冲突弹窗**——只弹版本弹窗（重装一并解决旧版占名冲突，两个遮罩弹窗不叠层）。
- **重启会话总线**：设置页「重启会话总线」按钮**常驻**——`systemctl --user restart dbus-broker.service` / `dbus.service`（30s 超时），成功后自动重新注册后端并刷新冲突报告；僵尸占名唯一有效的清除手段（已死进程的总线连接随总线重建释放）。
- **usocket 已移除**（v0.11.33）：dbus-next 的 optional 依赖 usocket（2016 年代原生 addon）在 Electron 43 下有 libuv 句柄 use-after-free（断开偶发 SIGSEGV / 退出挂起）且泄漏总线连接 FD——僵尸占名根因之一；移除后 dbus-next 回退 `net.Socket`，`unix:path=` 会话总线地址不受影响。

## 版本检查与一键重装（v0.11.33 起）

- **版本号文件**：安装时 root 级把当前版本写入 `<portal目录>/hoshineko.version`（`HOSHINEKO_PORTALS_DIR` 可覆盖目录；卸载时一并移除）。
- **启动检查**：应用启动时读取该文件并与当前版本比对——不一致弹 `PortalVersionDialog`（每次会话一次、取消不记忆每次启动弹）：打包版**取消 / 一键重装**（`system:reinstall-system-integration` 跑 `scripts/system-integration/reinstall.sh`——source install.sh/uninstall.sh 复用函数，卸载 + 安装合并为**单次 pkexec 授权**，完成后提示重启应用）；开发版仅取消 + portal 运行时诊断详情（打包版弹窗内按 PgDn 查看同一份详情）。
- **不弹的场景**：portal 未安装；版本号文件缺失（旧流程残留/不完整安装——曾有用户部分安装后误弹）。

## 为什么有些应用仍然弹自己的 GTK 对话框（v3.0.1006 起）

**门户只对"走门户的应用"生效。** 直接链接 GTK3/GTK4 的普通程序（LocalSend、
大量 Flutter/GTK 程序）用 `GtkFileChooserNative`，它**只有在 `GTK_USE_PORTAL=1`
或应用处于 Flatpak 等沙箱时才请求 xdg-desktop-portal**，否则直接弹自己的对话框，
根本不经过门户——此时改 `portals.conf` 不会有任何效果。

一键安装会写入 `~/.config/environment.d/60-hoshineko-portal.conf`
（`GTK_USE_PORTAL=1`），并尝试对当前 systemd 用户管理器 / D-Bus 激活环境立即生效：

```bash
# 已安装后手动立即验证（不改全局）
GTK_USE_PORTAL=1 localsend_app

# 让会话内所有 GTK 应用生效：注销重新登录（environment.d 在新会话读取）
```

卸载时只有"安装时新建"的这个文件会被删除；用户自建的同名配置保持不动。

Electron 应用同理：Electron 的打开对话框走 GTK（或 Ozone），需要同样的
`GTK_USE_PORTAL=1`；已经以自身方式打开文件的应用不受影响。

## 安装后门户不可用：systemd start-limit-hit（v3.0.1006 起）

反复安装/重装会在短时间内多次 `systemctl --user restart xdg-desktop-portal`，
命中 systemd 的启动频率限制后，portal 单元进入 `failed`（日志 `start-limit-hit`），
之后任何尝试都不会把它拉起来——现象就是**所有应用都回落到自带对话框、
`org.freedesktop.portal.FileChooser` 接口整个消失**（`gdbus introspect` 看不到）。

安装/卸载脚本现在会在重启前执行 `systemctl --user reset-failed
xdg-desktop-portal.service`。手动恢复：

```bash
systemctl --user reset-failed xdg-desktop-portal.service
systemctl --user restart xdg-desktop-portal.service
gdbus introspect --session --dest org.freedesktop.portal.Desktop \
  --object-path /org/freedesktop/portal/desktop | grep FileChooser
```

## 安装

1. **一键安装（推荐）**：设置 → 行为 →「系统集成」→「安装 Portal 集成」（经 pkexec 授权）——自动完成下述全部步骤、写入版本号文件并重启 portal 服务；或直接运行 `scripts/system-integration/install.sh`。

   一键安装还包含以下「应用自身安装」步骤（保证 D-Bus 激活有真实可执行体，并让默认打开不依赖原始 AppImage 的位置）：

   - **系统级二进制**：root 级把当前 AppImage 复制到 **`/usr/local/bin/HoshinekoFM`**（AppImage 经 FUSE 挂载运行，root 读不到挂载点，脚本会先以用户身份暂存到 /tmp 再交给 root 复制；开发模式无 AppImage 时跳过并告警）；
   - **D-Bus 激活文件**：安装时把模板里的 `Exec=/usr/bin/HoshinekoFM` 改写为 `Exec=/usr/local/bin/HoshinekoFM`（`packaging/dbus/*.service` 模板保留 `/usr/bin` 仅供发行版打包覆写）；
   - **用户级固定副本**：把当前 AppImage 复制到 **`~/.local/bin/HoshinekoFM`**（内容一致时幂等跳过），并把已有的 `~/.local/share/applications/HoshinekoFM.desktop` 的 `Exec` 统一到固定路径（系统级优先）。

   建议先完成设置里的「设为默认文件管理器」再安装系统集成；未完成时应用会弹确认提示（否则 `xdg-mime` 关联的桌面入口可能不存在，目录默认打开不指向本应用）。

2. **手动（等价）**：

   1. **portal 配置**（必需，root）：

   ```bash
   sudo install -m 644 packaging/portals/hoshineko.portal /usr/share/xdg-desktop-portal/portals/
   systemctl --user restart xdg-desktop-portal.service
   ```

   2. **应用二进制 + D-Bus 服务激活**（应用未运行时自动拉起；Exec 必须指向真实存在的二进制，模板默认 `/usr/bin/HoshinekoFM` 需按实际安装位置修改，一键安装统一为 `/usr/local/bin/HoshinekoFM`）：

   ```bash
   sudo cp HoshinekoFM-*.AppImage /usr/local/bin/HoshinekoFM && sudo chmod 755 /usr/local/bin/HoshinekoFM
   sudo install -m 644 packaging/dbus/org.freedesktop.impl.portal.desktop.hoshineko.service /usr/share/dbus-1/services/
   # 该文件的 Exec 行按实际位置修改，例如：
   #   Exec=/usr/local/bin/HoshinekoFM --portal
   ```

   3. **preferred 项**（确保本后端压过 gtk/gnome 等其他实现）：

   xdg-desktop-portal 对 `XDG_CURRENT_DESKTOP` 里的每个桌面名（小写）**优先读取**
   `~/.config/xdg-desktop-portal/<desktop>-portals.conf`，找到后不再读通用的
   `portals.conf`。niri/GNOME/KDE 等环境通常已有系统级桌面配置，所以只写
   `portals.conf` 会被完全忽略。正确做法（以 niri 为例）：

   ```bash
   mkdir -p ~/.config/xdg-desktop-portal
   # 在 niri-portals.conf 的 [preferred] 组内加入下面一行（保留原文件内容）
   # org.freedesktop.impl.portal.FileChooser=hoshineko
   ```

   一键安装会按同样规则处理：写入当前桌面实际生效的配置（用户级不存在
   时从系统级复制生成副本）、通用 `portals.conf`，以及所有已存在的用户
   级 `<desktop>-portals.conf`；新建的副本记录在
   `~/.config/xdg-desktop-portal/.hoshineko-portals-created`，卸载时整份删除。

   `hoshineko.portal` **不要写 `UseIn`**：它不是桌面专属实现，需要在所有桌面
   都可被 `portals.conf` 选中；`UseIn` 只能填桌面名（niri/GNOME/KDE），
   填接口名会导致实现不参与当前桌面的选择。

4. 验证（应用运行中）：

   ```bash
   gdbus call --session --dest org.freedesktop.impl.portal.desktop.hoshineko \
     --object-path /org/freedesktop/portal/desktop \
     --method org.freedesktop.impl.portal.FileChooser.OpenFile \
     "/org/freedesktop/portal/desktop/request/test/1" "appid" "" "测试" \
     "{'handle_token': <'test-1'>, 'multiple': <false>, 'directory': <false>, \
       'filters': <[('docx', [(0, '*.docx')]), ('img', [(1, 'image/png')])]>, \
       'current_filter': <('docx', [(0, '*.docx')])>}"
   ```

## 卸载

1. **一键卸载（推荐）**：设置 → 行为 →「系统集成」→「卸载 Portal 集成」（已安装时按钮自动变为卸载；经 pkexec 授权移除 root 级文件与版本号文件）；或直接运行 `scripts/system-integration/uninstall.sh`。**重装**用 `scripts/system-integration/reinstall.sh`（卸载 + 安装单次 pkexec，版本弹窗「一键重装」的执行体）。

   一键卸载同时移除安装时写入的应用副本（`/usr/local/bin/HoshinekoFM` 与 `~/.local/bin/HoshinekoFM`，仅移除 AppImage 形态、不动发行版自装的 ELF），并把桌面入口 `Exec` 恢复为当前 AppImage 运行路径（无 AppImage 环境时告警提示手动检查）。

2. **手动（等价）**：

   ```bash
   sudo rm -f /usr/share/xdg-desktop-portal/portals/hoshineko.portal
   sudo rm -f /usr/share/xdg-desktop-portal/portals/hoshineko.version
   sudo rm -f /usr/share/dbus-1/services/org.freedesktop.impl.portal.desktop.hoshineko.service
   # FileManager1 为通用总线名，确认内容属于本应用后再删：
   # sudo rm -f /usr/share/dbus-1/services/org.freedesktop.FileManager1.service
   # 一键安装写入的应用副本（确认是自己安装的 AppImage 再删）：
   # sudo rm -f /usr/local/bin/HoshinekoFM
   # rm -f ~/.local/bin/HoshinekoFM
   # 移除通用 portals.conf 与所有 <desktop>-portals.conf 中的 preferred=hoshineko 行
   #（安装时新建的配置副本按 .hoshineko-portals-created 清单整份删除）
   systemctl --user restart xdg-desktop-portal.service
   ```

   > `xdg-mime inode/directory` 的默认处理程序关联不受卸载影响（「设为默认文件管理器」是独立设置，可单独恢复）。

## 注意

- **升级 AppImage 后无需手动重跑安装**：D-Bus 服务激活文件指向 `/usr/local/bin/HoshinekoFM`（安装时从当前 AppImage 复制的副本），应用**未运行时**外部应用的对话框由该副本响应——升级后首次启动会检测到版本号文件不一致并弹「一键重装」弹窗（打包版；开发版显示运行时诊断详情），按提示重装即可更新副本与 portal 配置；不重装则带着旧版本功能（例如旧版保存对话框返回 NotSupported）。
- **服务模式常驻**：`--portal`/`--filemanager1` 激活的进程在窗口全部关闭后保持存活（与 gtk/gnome 的 portal 后端同为常驻服务），避免每次请求冷启动与「注册后即退出」的激活竞态；不弹主窗口。
- 多实例：后端以 DO_NOT_QUEUE 注册总线名，已有一个实例持有时后续实例静默跳过（不会抢名）。
- 无会话总线（无桌面环境）时自动跳过，不影响应用正常使用。
