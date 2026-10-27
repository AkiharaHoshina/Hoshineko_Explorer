#!/usr/bin/env bash
# 系统集成一键安装（幂等）：
#   - root 部分：portal 配置 + 两个 D-Bus 激活文件（Exec 统一改写为
#     /usr/local/bin/HoshinekoFM）+ 本应用二进制安装到
#     /usr/local/bin/HoshinekoFM（D-Bus 激活的实际执行体；
#     经 pkexec 授权，脚本以 --root 重入自身完成）；
#   - 用户级部分：portals.conf preferred 项、用户级固定副本
#     ~/.local/bin/HoshinekoFM（防原始 AppImage 被删）、桌面入口
#     Exec 统一到固定路径、xdg-mime 关联、portal 服务重启、
#     **清理旧的服务模式常驻进程**（--portal/--filemanager1，
#     精确匹配不杀 GUI 窗口；HOSHINEKO_SKIP_SERVICE_KILL=1 跳过）。
#
# 用法：
#   install.sh             # 用户级 + pkexec 重入 root 级（完整安装）
#   install.sh --root      # 仅 root 级（由 pkexec 调用，勿手动执行）
#   install.sh --user-only # 仅用户级（无 polkit 环境降级 / 测试用）
#
# 环境变量：
#   HOSHINEKO_PACKAGING_DIR  - packaging 目录（开发仓库或打包产物 resources）
#   HOSHINEKO_APPIMAGE_STAGE - AppImage 暂存文件路径（AppImage 经 FUSE 挂载
#                              运行，root 读不到挂载点内容：主入口以用户身份
#                              先暂存到 /tmp，root 重入时从此复制安装）
#   HOSHINEKO_VERSION        - 应用版本号（写入 portal 目录的 hoshineko.version，
#                              供应用启动时检测「已安装 portal 版本 ≠ 当前
#                              版本」并提示重装；pkexec 会消毒环境，重入时
#                              须显式透传）
#   HOSHINEKO_PORTALS_DIR    - portal 配置目录覆盖（默认 /usr/share/...；
#                              测试沙箱用）
#   APPIMAGE                 - AppImage 运行路径（用户级副本与桌面入口用；
#                              pkexec 会消毒环境，重入时须显式透传）
#
# 本脚本可被 reinstall.sh source 复用函数（见 reinstall.sh）：主入口 case
# 包裹在 BASH_SOURCE 守卫内，被 source 时不执行主流程。
set -euo pipefail

PKG_DIR="${HOSHINEKO_PACKAGING_DIR:?需要 HOSHINEKO_PACKAGING_DIR（packaging 目录路径）}"

PORTALS_DIR="${HOSHINEKO_PORTALS_DIR:-/usr/share/xdg-desktop-portal/portals}"
SERVICES_DIR="/usr/share/dbus-1/services"
PORTALS_CONF_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/xdg-desktop-portal"
PORTAL_PREF_LINE="org.freedesktop.impl.portal.FileChooser=hoshineko"
# 记录安装时新建的用户级配置（桌面配置副本/通用文件），卸载时删除
PORTALS_CREATED_LIST="$PORTALS_CONF_DIR/.hoshineko-portals-created"
# GTK 门户开关：GTK 应用（LocalSend、各类 Flutter/GTK 程序）默认自绘
# GTK 对话框，完全不经过 xdg-desktop-portal；GTK_USE_PORTAL=1 才会走
# portal → 本后端。写入 environment.d，注销重登后生效。
ENV_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/environment.d"
ENV_CONF="$ENV_DIR/60-hoshineko-portal.conf"
ENV_CREATED_LIST="$ENV_DIR/.hoshineko-created"
# 用户级 FileManager1 激活文件：D-Bus 在同名 .service 重复时按
# XDG_DATA_HOME → XDG_DATA_DIRS 顺序取先命中者，用户目录优先于
# /usr/share——Dux Files 等同样注册 org.freedesktop.FileManager1 的
# 应用会在冷激活时抢走 Firefox「在文件夹中显示」，用户级文件保证激活
# 到本应用。
USER_SERVICES_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/dbus-1/services"
FM1_USER_SERVICE="$USER_SERVICES_DIR/org.freedesktop.FileManager1.service"
SERVICES_CREATED_LIST="$USER_SERVICES_DIR/.hoshineko-created"
# 固定安装路径（可经环境变量覆盖：测试沙箱 / 定制安装）
SYSTEM_BIN="${HOSHINEKO_SYSTEM_BIN:-/usr/local/bin/HoshinekoFM}"
USER_BIN="${HOSHINEKO_USER_BIN:-$HOME/.local/bin/HoshinekoFM}"
DESKTOP_FILE="$HOME/.local/share/applications/HoshinekoFM.desktop"

# AppImage 魔数校验（偏移 8 起为 "AI"）：卸载时只移除本安装脚本写入的 AppImage 副本
is_appimage() {
  [ -f "$1" ] && [ "$(dd if="$1" bs=1 skip=8 count=2 2>/dev/null)" = "AI" ]
}

# 桌面条目 Exec 参数值（条件引号）：仅当值含保留字符（空格/引号/反斜杠
# 等）时按桌面条目规范加引号并转义，简单路径裸写。无条件加引号虽符合
# 规范，但 xdg-utils（xdg-mime query default 的 desktop_file_to_binary）
# 解析 Exec 时不剥引号，带引号的默认程序被判定「不存在」并静默回落到
# 系统级 mimeapps 默认（niri 等未注册桌面上所有 xdg-open generic 应用
# 都会忽略用户默认）；简单路径必须裸写。
desktop_exec_arg() {
  case "$1" in
    *[!A-Za-z0-9_./:+@%-]*) printf '"%s"' "$(printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g')" ;;
    *) printf '%s' "$1" ;;
  esac
}

# 重写桌面入口的 Exec 行（sed 的替换串会解释反斜杠、破坏转义路径；
# 经 awk ENVIRON 透传字面值，任何路径形态均不丢失）
set_desktop_exec() {
  local file="$1" value="$2"
  export HOSHINEKO_DESKTOP_EXEC="$value"
  awk '{ if (substr($0, 1, 5) == "Exec=") print "Exec=" ENVIRON["HOSHINEKO_DESKTOP_EXEC"] " %U"; else print }' \
    "$file" > "$file.tmp" && mv "$file.tmp" "$file"
  unset HOSHINEKO_DESKTOP_EXEC
}

# 在系统配置搜索路径中查找 `<desktop>-portals.conf`（不含用户级）。
# 路径顺序与 xdg-desktop-portal 一致：XDG_CONFIG_DIRS → /etc →
# XDG_DATA_HOME → XDG_DATA_DIRS → /usr/share。找到第一个即返回。
find_system_portals_conf() {
  local base="$1" dir file
  while IFS= read -r dir; do
    [ -n "$dir" ] || continue
    file="$dir/xdg-desktop-portal/$base"
    if [ -f "$file" ]; then
      printf '%s\n' "$file"
      return
    fi
  done < <(
    printf '%s\n' \
      "${XDG_CONFIG_DIRS:-/etc/xdg}" \
      /etc \
      "${XDG_DATA_HOME:-$HOME/.local/share}" \
      "${XDG_DATA_DIRS:-/usr/local/share:/usr/share}" \
      /usr/share | tr ':' '\n'
  )
}

# 需要写入 preferred 项的用户级配置集合（去重）：
# - 当前 XDG_CURRENT_DESKTOP 每个桌面名：用户级文件存在则改它；
#   不存在但系统级存在则生成用户级副本（否则系统桌面配置会遮蔽通用
#   portals.conf，preferred 永远不生效）；
# - 通用 portals.conf（没有桌面专属配置的环境兜底）；
# - 已存在的其他 `<desktop>-portals.conf`（多桌面用户切换会话后仍生效）。
install_portals_conf_targets() {
  local name lower target system_conf f
  {
    while IFS= read -r name; do
      [ -n "$name" ] || continue
      lower="$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]')"
      target="$PORTALS_CONF_DIR/$lower-portals.conf"
      if [ -f "$target" ]; then
        printf '%s\n' "$target"
      else
        system_conf="$(find_system_portals_conf "$lower-portals.conf")"
        [ -n "$system_conf" ] && printf '%s\n' "$target"
      fi
    done < <(printf '%s\n' "${XDG_CURRENT_DESKTOP:-}" | tr ':' '\n')
    printf '%s\n' "$PORTALS_CONF_DIR/portals.conf"
    for f in "$PORTALS_CONF_DIR"/*-portals.conf; do
      [ -f "$f" ] || continue
      printf '%s\n' "$f"
    done
  } | awk '!seen[$0]++'
}

# 确保用户级配置存在：桌面专属配置从系统副本复制（保留 default=...
# 等其他键）；通用文件新建空 [preferred]。新建时登记到 created 列表，
# 卸载时整份删除以恢复系统行为。
ensure_portals_conf_file() {
  local file="$1" base system_conf
  [ -f "$file" ] && return 0
  mkdir -p "$(dirname "$file")"
  base="$(basename "$file")"
  if [ "$base" != "portals.conf" ]; then
    system_conf="$(find_system_portals_conf "$base")"
    if [ -n "$system_conf" ]; then
      cp "$system_conf" "$file"
    fi
  fi
  if [ ! -f "$file" ]; then
    printf '[preferred]\n' > "$file"
  fi
  mkdir -p "$(dirname "$PORTALS_CREATED_LIST")"
  grep -qxF "$file" "$PORTALS_CREATED_LIST" 2>/dev/null || printf '%s\n' "$file" >> "$PORTALS_CREATED_LIST"
}

# 在指定 portals.conf 的 [preferred] 组写入/替换 preferred=hoshineko。
# 保留文件原有内容（default=... 等其他键），已有同名键只改值、不重复；
# 没有 [preferred] 组则在末尾追加。不能用 `>>` 盲目追加——会把键写进
# 上一个分组或制造重复分组。
set_portal_preference() {
  local file="$1" tmp
  mkdir -p "$(dirname "$file")"
  if [ ! -f "$file" ]; then
    printf '[preferred]\n%s\n' "$PORTAL_PREF_LINE" > "$file"
    return
  fi
  tmp="$(mktemp "${file}.XXXXXX")"
  PORTAL_PREF_LINE="$PORTAL_PREF_LINE" awk '
    BEGIN { in_pref = 0; done = 0 }
    /^[[:space:]]*\[/ {
      if (in_pref && !done) { print ENVIRON["PORTAL_PREF_LINE"]; done = 1 }
      section = $0
      sub(/^[[:space:]]*\[/, "", section)
      sub(/\][[:space:]]*$/, "", section)
      in_pref = (section == "preferred")
      print
      next
    }
    in_pref && $0 ~ /^[[:space:]]*org\.freedesktop\.impl\.portal\.FileChooser[[:space:]]*=/ {
      if (!done) { print ENVIRON["PORTAL_PREF_LINE"]; done = 1 }
      next
    }
    { print }
    END {
      if (!done) {
        if (!in_pref) print "[preferred]"
        print ENVIRON["PORTAL_PREF_LINE"]
      }
    }
  ' "$file" > "$tmp"
  # 用 cat 覆盖而不是 mv：保留原文件的属主/权限
  cat "$tmp" > "$file"
  rm -f "$tmp"
}

# 会话总线名（与 packaging/dbus 激活文件的 Name 一致）：busctl 按名
# 解析拥有者 PID 精确击杀，不依赖进程 cmdline 长相——AppImage 被改名、
# 非标准路径启动的旧常驻也能命中（cmdline 匹配兜底只覆盖「路径含
# HoshinekoFM」的进程）。
PORTAL_BUS_NAME="org.freedesktop.impl.portal.desktop.hoshineko"
FM1_BUS_NAME="org.freedesktop.FileManager1"

# 解析会话总线名拥有者 PID。busctl 缺失/会话总线不可用/名字无主 → 输出空。
# timeout 兜底：异常总线状态下 busctl 可能挂起，不能拖死安装流程。
# 注意末行 `|| true`：set -o pipefail 下 busctl 对无主名字以非零退出
# （dbus-broker 报 Failed to get credentials: No such device or address），
# 命令替换 `pid="$(bus_owner_pid ...)"` 会继承该失败并在 set -e 下炸掉
# 整个安装流程——「名字无主」是正常状态，必须吞掉非零退出码。
bus_owner_pid() {
  command -v busctl >/dev/null 2>&1 || return 0
  timeout 5 busctl --user status "$1" 2>/dev/null \
    | awk '/^[[:space:]]*PID=/{sub(/^[[:space:]]*PID=/,""); print; exit}' \
    || true
}

# 判断 PID 是否本应用服务模式常驻（cmdline 含 --portal / --filemanager1）。
# 总线名拥有者可能是正在运行的 GUI（无服务参数）——杀 GUI 会丢未落盘
# 数据（安装脚本由 GUI 调用，杀 GUI 等于自杀），只能警告提示重启应用。
is_service_resident() {
  [ -r "/proc/$1/cmdline" ] || return 1
  tr '\0' ' ' < "/proc/$1/cmdline" | grep -Eq -- '--(portal|filemanager1)'
}

# 进程是否已死亡（含僵尸）：僵尸对 kill -0 恒为「存活」、SIGKILL 亦无效
# （父进程尚未收割），但其总线连接早已随进程退出关闭——视为已清理。
# 用 /proc/<pid>/status 的 State 判定（stat 的 comm 字段可含空格不可靠）。
proc_dead() {
  if ! kill -0 "$1" 2>/dev/null; then return 0; fi
  local state
  state="$(awk '/^State:/{print $2}' "/proc/$1/status" 2>/dev/null || true)"
  [ "$state" = "Z" ]
}

# 对单个 PID：TERM → 最多等 5 秒 → 仍存活升级 KILL → 验证退出。
# 挂死/忙死的常驻（TERM 无效）不升级会继续持总线名应答旧请求。
# TERM 送达失败时区分两种情形：进程已自行退出（ESRCH——busctl 解析
# 与击杀之间的竞态，常驻恰好死亡）或已成僵尸，均视为已清理；
# 仍存活（EPERM 等）才判失败。
kill_pid_escalate() {
  local pid="$1"
  if ! kill -TERM "$pid" 2>/dev/null; then
    if proc_dead "$pid"; then return 0; fi
    return 1
  fi
  local i
  for i in 1 2 3 4 5; do
    if proc_dead "$pid"; then return 0; fi
    sleep 1
  done
  echo "[warn] PID $pid 未响应 SIGTERM，升级 SIGKILL" >&2
  kill -KILL "$pid" 2>/dev/null || true
  sleep 1
  if proc_dead "$pid"; then return 0; fi
  echo "[warn] PID $pid 仍存活（不可中断状态或权限不足），总线名可能仍被占用" >&2
  return 1
}

# 清理旧的服务模式常驻进程（--portal / --filemanager1 形态）：旧常驻
# 持总线名会让升级后的新版永远不生效——固定路径 Exec 已更新，杀掉后
# 下次 D-Bus 激活即 spawn 新版（或由应用侧在安装成功后立即重新注册
# 接管）。策略：
#   1. 首选 busctl 按总线名解析拥有者 PID 精确击杀（AppImage 改名等
#      cmdline 不含 HoshinekoFM 的旧常驻也能命中）；拥有者非服务形态
#      （正在运行的 GUI / 其他文件管理器占 FileManager1）时不杀，仅警告；
#   2. 兜底 cmdline 模式匹配（覆盖其他会话总线残留 + 无 busctl 环境），
#      精确匹配服务参数、不杀 GUI 窗口；
#   3. 两路都带 TERM → KILL 升级与存活验证，杜绝「杀不掉仍在应答」。
# e2e/沙箱环境设 HOSHINEKO_SKIP_SERVICE_KILL=1 跳过
# （避免测试进程误杀真实会话中的常驻服务）。
kill_stale_services() {
  echo "[user] 清理旧 portal/FileManager1 常驻进程"
  if [ -n "${HOSHINEKO_SKIP_SERVICE_KILL:-}" ]; then
    echo "[user] HOSHINEKO_SKIP_SERVICE_KILL 已设置，跳过 kill"
    return
  fi
  if command -v busctl >/dev/null 2>&1; then
    local bus_name pid
    for bus_name in "$PORTAL_BUS_NAME" "$FM1_BUS_NAME"; do
      pid="$(bus_owner_pid "$bus_name")"
      [ -n "$pid" ] || continue
      if ! is_service_resident "$pid"; then
        echo "[warn] $bus_name 由非服务模式进程持有（PID $pid）：若为正在运行的 HoshinekoFM，请重启应用使新版接管" >&2
        continue
      fi
      echo "[user] 击杀 $bus_name 旧常驻（PID $pid）"
      kill_pid_escalate "$pid"
    done
  fi
  if command -v pkill >/dev/null 2>&1; then
    local pattern i
    for pattern in 'HoshinekoFM.*--portal' 'HoshinekoFM.*--filemanager1'; do
      pkill -TERM -f "$pattern" 2>/dev/null || true
      i=0
      while pgrep -f "$pattern" >/dev/null 2>&1 && [ "$i" -lt 5 ]; do
        sleep 1
        i=$((i + 1))
      done
      pkill -KILL -f "$pattern" 2>/dev/null || true
    done
  else
    echo "[warn] 缺少 pkill：旧常驻进程需手动清理" >&2
  fi
}

# 原子替换安装：写同目录临时文件再 rename。
# 直接 `install` 到既有路径会 O_TRUNC 原 inode——正在运行的 AppImage
# 进程（以及安装过程中被 D-Bus 激活的新进程）mmap 到被截断的文件会
# 立刻 SIGBUS，xdg-desktop-portal 报
# "Activated service ... received signal 7"，FileChooser 接口整个消失。
# 原子替换让旧进程继续使用旧 inode，新进程读到完整文件。
# 源与目标完全一致时直接跳过（避免无谓重写，也减少上述竞态窗口）。
atomic_install() {
  local src="$1" dst="$2" mode="$3" tmp
  if [ -f "$dst" ] && cmp -s "$src" "$dst"; then
    return 0
  fi
  mkdir -p "$(dirname "$dst")"
  tmp="$(dirname "$dst")/.$(basename "$dst").hoshineko.$$"
  cp "$src" "$tmp"
  chmod "$mode" "$tmp"
  mv -f "$tmp" "$dst"
}

root_install() {
  install -d -m 755 "$PORTALS_DIR" "$SERVICES_DIR" "$(dirname "$SYSTEM_BIN")"
  atomic_install "$PKG_DIR/portals/hoshineko.portal" "$PORTALS_DIR/hoshineko.portal" 644
  # D-Bus 激活文件：Exec 统一指向固定安装路径（模板默认为 /usr/bin/HoshinekoFM）
  # 先写临时文件、sed 替换 Exec，再原子 rename
  local fm1_svc="$SERVICES_DIR/org.freedesktop.FileManager1.service"
  local portal_svc="$SERVICES_DIR/org.freedesktop.impl.portal.desktop.hoshineko.service"
  local tmp
  tmp="$(dirname "$fm1_svc")/.$(basename "$fm1_svc").hoshineko.$$"
  cp "$PKG_DIR/dbus/org.freedesktop.FileManager1.service" "$tmp"
  sed -i "s|^Exec=/usr/bin/HoshinekoFM|Exec=$SYSTEM_BIN|" "$tmp"
  chmod 644 "$tmp"
  mv -f "$tmp" "$fm1_svc"
  tmp="$(dirname "$portal_svc")/.$(basename "$portal_svc").hoshineko.$$"
  cp "$PKG_DIR/dbus/org.freedesktop.impl.portal.desktop.hoshineko.service" "$tmp"
  sed -i "s|^Exec=/usr/bin/HoshinekoFM|Exec=$SYSTEM_BIN|" "$tmp"
  chmod 644 "$tmp"
  mv -f "$tmp" "$portal_svc"

  # 本应用二进制 → /usr/local/bin/HoshinekoFM（D-Bus 激活的执行体）
  if [ -n "${HOSHINEKO_APPIMAGE_STAGE:-}" ] && [ -f "$HOSHINEKO_APPIMAGE_STAGE" ]; then
    if [ -f "$SYSTEM_BIN" ] && cmp -s "$HOSHINEKO_APPIMAGE_STAGE" "$SYSTEM_BIN"; then
      echo "[root] $SYSTEM_BIN 已是最新，跳过重写（避免截断运行中进程）"
    else
      atomic_install "$HOSHINEKO_APPIMAGE_STAGE" "$SYSTEM_BIN" 755
      echo "[root] 应用已安装到 $SYSTEM_BIN"
    fi
  elif [ -x "$SYSTEM_BIN" ] || [ -x /usr/bin/HoshinekoFM ]; then
    echo "[root] 检测到已安装的 HoshinekoFM，跳过二进制安装"
  else
    echo "[warn] 无 AppImage 暂存文件（开发模式或非 AppImage 运行）：跳过二进制安装，D-Bus 激活可能不可用" >&2
  fi

  # 版本号文件：应用启动时读取并与当前版本比较，不一致则提示重装
  # （见 electron/handlers/system.ts system:get-portal-runtime-info）。
  # HOSHINEKO_VERSION 由应用侧 runIntegrationScript 注入；手动运行时
  # 缺省则跳过写入（保留旧文件内容）。
  if [ -n "${HOSHINEKO_VERSION:-}" ]; then
    printf '%s\n' "$HOSHINEKO_VERSION" > "$PORTALS_DIR/hoshineko.version"
    echo "[root] 版本号文件已写入 $PORTALS_DIR/hoshineko.version（$HOSHINEKO_VERSION）"
  else
    echo "[warn] 无 HOSHINEKO_VERSION：跳过版本号文件写入（手动运行 install.sh 时属正常）" >&2
  fi
  echo "[root] portal 配置与 D-Bus 激活文件已安装"
}

# 写入用户级 FileManager1 激活文件（优先于 /usr/share 下的同名文件）。
# 已存在且不是本应用的（用户自建）不覆盖，只提示。
install_user_fm1_service() {
  local exec_bin="$USER_BIN"
  [ -x "$exec_bin" ] || exec_bin="$SYSTEM_BIN"
  [ -x "$exec_bin" ] || return 0
  if [ -f "$FM1_USER_SERVICE" ] && ! grep -q 'HoshinekoFM' "$FM1_USER_SERVICE"; then
    echo "[user] $FM1_USER_SERVICE 已存在且非本应用，跳过（如需优先请手动处理）"
    return 0
  fi
  mkdir -p "$USER_SERVICES_DIR"
  {
    printf '# Hoshineko：用户级 FileManager1 激活文件\n'
    printf '# 用户目录优先于 /usr/share，避免其他文件管理器的同名文件抢走激活\n'
    printf '[D-BUS Service]\n'
    printf 'Name=org.freedesktop.FileManager1\n'
    printf 'Exec=%s --filemanager1\n' "$exec_bin"
  } > "$FM1_USER_SERVICE"
  grep -qxF "$FM1_USER_SERVICE" "$SERVICES_CREATED_LIST" 2>/dev/null \
    || printf '%s\n' "$FM1_USER_SERVICE" >> "$SERVICES_CREATED_LIST"
  echo "[user] $FM1_USER_SERVICE 已写入（FileManager1 冷激活优先本应用）"
}

# 让 GTK 应用走门户：GTK 的 GtkFileChooserNative 只有在 GTK_USE_PORTAL=1
# （或沙箱内）时才请求 xdg-desktop-portal，否则直接弹自己的对话框。
# LocalSend（file_selector_linux）、大量 GTK/Flutter 程序都属于后者。
# 写入 ~/.config/environment.d（新登录生效）；已存在则不动。
install_gtk_portal_env() {
  if [ -f "$ENV_CONF" ]; then
    echo "[user] $ENV_CONF 已存在，跳过"
    return
  fi
  mkdir -p "$ENV_DIR"
  {
    printf '# Hoshineko：让 GTK 应用通过 xdg-desktop-portal 选择文件\n'
    printf '# 由 Hoshineko 系统集成一键安装创建，卸载时自动删除\n'
    printf 'GTK_USE_PORTAL=1\n'
  } > "$ENV_CONF"
  printf '%s\n' "$ENV_CONF" >> "$ENV_CREATED_LIST"
  echo "[user] $ENV_CONF 已写入 GTK_USE_PORTAL=1（重新登录后生效）"
}

# 当前会话尽量即时生效：systemd 用户管理器 + D-Bus 激活环境。
# 仅在安装到真实家目录时执行——e2e 沙箱 HOME 下不污染开发者会话。
apply_gtk_portal_env_now() {
  local real_home
  real_home="$(getent passwd "$(id -u)" 2>/dev/null | cut -d: -f6)"
  [ -n "$real_home" ] && [ "$HOME" = "$real_home" ] || return 0
  if command -v systemctl >/dev/null 2>&1; then
    systemctl --user set-environment GTK_USE_PORTAL=1 2>/dev/null || true
  fi
  if command -v dbus-update-activation-environment >/dev/null 2>&1; then
    dbus-update-activation-environment GTK_USE_PORTAL=1 2>/dev/null || true
  fi
}

user_install() {
  # 用户级固定副本：防原始 AppImage 被移动/删除后默认打开失效（幂等：内容一致则跳过）。
  # 复制源：APPIMAGE 优先；应用从已删除的副本运行时回退到 root 级刚安装的固定路径。
  local copy_src=""
  if [ -n "${APPIMAGE:-}" ] && [ -f "$APPIMAGE" ]; then
    copy_src="$APPIMAGE"
  elif [ -x "$SYSTEM_BIN" ]; then
    copy_src="$SYSTEM_BIN"
  fi
  if [ -n "$copy_src" ]; then
    if [ -f "$USER_BIN" ] && cmp -s "$copy_src" "$USER_BIN"; then
      echo "[user] 用户级副本已是最新（$USER_BIN）"
    else
      # 原子替换：直接覆盖会截断正在作为 --portal/--filemanager1 常驻的
      # 旧 inode，触发 SIGBUS（portal 侧“received signal 7”）
      atomic_install "$copy_src" "$USER_BIN" 755
      echo "[user] 应用已复制到 $USER_BIN"
    fi
  fi

  # 桌面入口 Exec 统一到固定路径：优先系统级二进制，其次用户级副本
  if [ -f "$DESKTOP_FILE" ]; then
    if [ -x "$SYSTEM_BIN" ]; then
      set_desktop_exec "$DESKTOP_FILE" "$(desktop_exec_arg "$SYSTEM_BIN")"
      echo "[user] $DESKTOP_FILE Exec → $SYSTEM_BIN"
    elif [ -x "$USER_BIN" ]; then
      set_desktop_exec "$DESKTOP_FILE" "$(desktop_exec_arg "$USER_BIN")"
      echo "[user] $DESKTOP_FILE Exec → $USER_BIN"
    fi
  fi

  # 写入所有用户级候选配置（当前桌面实际生效文件 + 通用文件 + 其他已存在
  # 的桌面配置）。桌面专属配置优先于通用 portals.conf，只写后者在 niri/
  # GNOME/KDE 等带桌面配置的环境里会被完全忽略。
  while IFS= read -r conf; do
    [ -n "$conf" ] || continue
    ensure_portals_conf_file "$conf"
    set_portal_preference "$conf"
    echo "[user] ${conf} 已写入 preferred=hoshineko"
  done < <(install_portals_conf_targets)

  # 用户级 FileManager1 激活文件（优先于 /usr/share 同名文件）
  install_user_fm1_service

  # GTK 应用默认绕过门户，必须显式开启 GTK_USE_PORTAL
  install_gtk_portal_env
  apply_gtk_portal_env_now

  # 桌面入口 + mime 关联（与设置「设为默认」同效果，幂等）
  if command -v xdg-mime >/dev/null 2>&1; then
    xdg-mime default HoshinekoFM.desktop inode/directory >/dev/null 2>&1 || true
    echo "[user] xdg-mime inode/directory → HoshinekoFM.desktop"
  fi

  # 重启 portal 服务（新 .portal 配置生效）。--no-block：systemctl 只入队
  # 立即返回——portal 单元卡在 activating（会话总线被僵尸占名拖死）时
  # 阻塞式 restart 会永久挂起，导致安装流程永不返回、应用侧按钮一直
  # 忙碌禁用；timeout 作双保险。
  if command -v systemctl >/dev/null 2>&1; then
    # 先清 failed 计数：反复安装/重启会触发 systemd start-limit-hit，
    # 之后任何 start 都被拒绝，portal 直接不可用（FileChooser 消失，
    # 所有应用回落到自带对话框）——这是"装了却不生效"的真实成因之一。
    timeout 20 systemctl --user reset-failed xdg-desktop-portal.service 2>/dev/null || true
    timeout 20 systemctl --user --no-block restart xdg-desktop-portal.service 2>/dev/null || true
    echo "[user] xdg-desktop-portal 服务已重启"
    # 验证宿主 portal 是否成功建立 FileChooser 代理：后端激活崩溃时
    # portal 只会在启动日志里报错，接口整体消失（应用端表现为“完全不
    # 工作”）。这里主动检查并提示。
    if command -v gdbus >/dev/null 2>&1; then
      sleep 1
      if ! gdbus introspect --session --dest org.freedesktop.portal.Desktop \
          --object-path /org/freedesktop/portal/desktop 2>/dev/null \
          | grep -q 'interface org.freedesktop.portal.FileChooser'; then
        echo "[warn] xdg-desktop-portal 未提供 FileChooser 接口（后端激活失败）——" \
          "请确认 $SYSTEM_BIN 可执行，然后执行：" \
          "systemctl --user reset-failed xdg-desktop-portal.service && systemctl --user restart xdg-desktop-portal.service" >&2
      fi
    fi
  fi

  # 清理旧的服务模式常驻进程：不杀则升级后的新版（新 Exec/新二进制）
  # 永远不会被 D-Bus 激活或应答请求
  kill_stale_services
}

# 主入口守卫：被 reinstall.sh source 复用函数时（BASH_SOURCE[0] != $0）
# 不执行主流程，仅暴露 root_install/user_install/kill_stale_services 等函数。
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
case "${1:-}" in
  --root)
    root_install
    ;;
  --user-only)
    user_install
    ;;
  *)
    stage=""
    # 注意：EXIT trap 的返回值会成为脚本的最终退出码。stage 为空时
    # （开发模式 / 非 AppImage 运行）旧写法 `[ -n "$stage" ] && rm` 在
    # set -e 下使 trap 以 1 结束 → 安装明明成功却被报「安装失败」。
    cleanup_stage() {
      if [ -n "$stage" ]; then
        rm -f "$stage"
      fi
    }
    trap cleanup_stage EXIT
    if [ "$(id -u)" -ne 0 ]; then
      if command -v pkexec >/dev/null 2>&1; then
        # 暂存源：APPIMAGE 优先；应用从已删除的副本运行时（APPIMAGE 指向
        # 不存在的文件，卸载后未重启的实例）回退到其他固定副本；
        # 全部缺失时明确报错（避免「输入密码后才发现装不了二进制」）。
        stage_src=""
        if [ -n "${APPIMAGE:-}" ] && [ -f "$APPIMAGE" ]; then
          stage_src="$APPIMAGE"
        elif [ -n "${APPIMAGE:-}" ]; then
          if [ -f "$USER_BIN" ]; then stage_src="$USER_BIN"; fi
          if [ -z "$stage_src" ] && [ -x "$SYSTEM_BIN" ]; then stage_src="$SYSTEM_BIN"; fi
          if [ -z "$stage_src" ]; then
            echo "[error] APPIMAGE 指向的文件不存在且无其他可用副本：请从原始 AppImage 启动应用后重试安装" >&2
            exit 1
          fi
        fi
        if [ -n "$stage_src" ]; then
          stage="$(mktemp /tmp/hoshineko-appimage-stage.XXXXXX)"
          cp "$stage_src" "$stage"
          chmod 644 "$stage"
        fi
        pkexec env "HOSHINEKO_PACKAGING_DIR=$PKG_DIR" \
          "HOSHINEKO_APPIMAGE_STAGE=$stage" \
          "HOSHINEKO_PORTALS_DIR=$PORTALS_DIR" \
          "HOSHINEKO_VERSION=${HOSHINEKO_VERSION:-}" \
          "APPIMAGE=${APPIMAGE:-}" "$0" --root
      else
        echo "[warn] 缺少 pkexec：跳过 root 级安装（portal 配置/激活文件需手动安装，见 README 系统集成）" >&2
      fi
    else
      root_install
    fi
    user_install
    ;;
esac
fi
