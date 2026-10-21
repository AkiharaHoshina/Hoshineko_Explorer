#!/usr/bin/env python3
"""生成 Material Symbols Rounded 图标子集字体。

背景
----
`@fontsource-variable/material-symbols-rounded/full.css` 的字体约 5.35 MB，
但应用实际只用到约 200 个图标。直接 `pyftsubset --text=...` 不行：图标是
连字（ligature），保留 26 个字母后 GSUB 闭包会把**所有**图标输出字形都
拉进来（子集仍有 5.2 MB）。本脚本改为：

1. 扫描 `src/` 与 `electron/` 里的标识符式字符串，得到候选图标名；
2. 解析字体 GSUB（Extension → LigatureSubst），只收集与候选名精确匹配的
   连字输出字形；
3. 以「基础字母 + 命中的输出字形」做 `--glyphs-file` 子集，并关闭
   `--layout-closure`（否则又会全量闭包）。

结果约 190 KB。新增图标后必须重跑：

    npm run icons:subset

依赖：`python3 -m fontTools`（需 brotli 支持 woff2）。字体源来自
node_modules，需先 `npm install`。
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
from fontTools.ttLib import TTFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(
    ROOT,
    "node_modules/@fontsource-variable/material-symbols-rounded/files/"
    "material-symbols-rounded-latin-full-normal.woff2",
)
OUT = os.path.join(ROOT, "src/assets/fonts/MaterialSymbolsRounded-subset.woff2")

# 动态拼出的图标名兜底（对象类图标、设备图标等经变量传递的常见值）。
# 不在字体里的名字会在 missing 报告里出现，按需删掉即可。
EXTRA_NAMES = """
folder home search settings delete refresh add close arrow_upward arrow_downward
chevron_left chevron_right expand_more expand_less more_vert grid_view view_list
sort tune image movie description code archive insert_drive_file link link_off
hard_drive keyboard swap_vert hub devices terminal_2 developer_board stacks
auto_delete memory widgets tag photo_camera smartphone picture_as_pdf audio_file
video_file play_arrow pause download upload content_copy content_cut content_paste
create_new_folder note_add drive_file_rename_outline info error warning check
visibility visibility_off lock lock_open power_settings_new wifi battery_full
device_thermostat light_mode app_shortcut terminal account_tree filter_none
crop_square minimize maximize window close fullscreen fullscreen_exit open_in_new
location_on folder_open folder_special star star_border push_pin archive
restore_from_trash delete_forever select_all deselect clear done edit save undo
redo print share
""".split()

IDENTIFIER_RE = re.compile(r"""['"]([a-z][a-z0-9_]{1,40})['"]""")


def collect_names() -> set[str]:
    """收集候选图标名：源码里的标识符式字符串 + EXTRA_NAMES。"""
    names: set[str] = set(EXTRA_NAMES)
    for base in ("src", "electron"):
        for dirpath, _, files in os.walk(os.path.join(ROOT, base)):
            for fn in files:
                if not fn.endswith((".ts", ".tsx")):
                    continue
                try:
                    text = open(os.path.join(dirpath, fn), encoding="utf-8").read()
                except OSError:
                    continue
                names.update(IDENTIFIER_RE.findall(text))
    return names


def glyph_char(glyph: str, glyph_to_char: dict[str, str]) -> str:
    """字形名 → 字符。Material Symbols 的数字/下划线用 digit_/underscore。"""
    if glyph in glyph_to_char:
        return glyph_to_char[glyph]
    if glyph == "underscore":
        return "_"
    m = re.fullmatch(r"digit_(\w+)", glyph)
    if m:
        return str(
            {"zero": 0, "one": 1, "two": 2, "three": 3, "four": 4,
             "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9}
            .get(m.group(1), "?")
        )
    return "?"


def iter_ligatures(lookup):
    """遍历 LigatureSubst（含 Extension 包装）。"""
    for sub in lookup.SubTable:
        if lookup.LookupType == 7:
            sub = sub.ExtSubTable
        elif lookup.LookupType != 4:
            continue
        for first, ligs in getattr(sub, "ligatures", {}).items():
            for lig in ligs:
                yield first, list(lig.Component), lig.LigGlyph


def main() -> int:
    if not os.path.exists(SRC):
        print(f"找不到字体源：{SRC}\n请先运行 npm install", file=sys.stderr)
        return 1

    names = collect_names()
    font = TTFont(SRC)
    cmap = font.getBestCmap()
    glyph_to_char = {g: chr(c) for c, g in cmap.items()}
    base_glyphs = {
        g
        for name in names
        for ch in name
        for c, g in cmap.items()
        if chr(c) == ch
    }

    ligature_outputs: set[str] = set()
    found: set[str] = set()
    for lookup in font["GSUB"].table.LookupList.Lookup:
        for first, components, output in iter_ligatures(lookup):
            text = "".join(glyph_char(g, glyph_to_char) for g in [first, *components])
            if text in names:
                ligature_outputs.add(output)
                found.add(text)

    missing = sorted(set(EXTRA_NAMES) - found)
    if missing:
        print(f"注意：EXTRA_NAMES 中 {len(missing)} 个名字在字体里无连字：{missing}")

    glyphs = sorted(base_glyphs | ligature_outputs | {".notdef", "space"})
    glyphs_file = os.path.join(ROOT, "node_modules/.cache/hoshineko-icon-glyphs.txt")
    os.makedirs(os.path.dirname(glyphs_file), exist_ok=True)
    with open(glyphs_file, "w", encoding="utf-8") as f:
        f.write("\n".join(glyphs))

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    cmd = [
        sys.executable, "-m", "fontTools.subset", SRC,
        f"--glyphs-file={glyphs_file}",
        "--flavor=woff2",
        "--layout-features=*",
        # 必须：保留默认闭包会把全部图标字形拉回来（5.2 MB）
        "--no-layout-closure",
        "--name-IDs=*",
        "--no-hinting",
        f"--output-file={OUT}",
    ]
    result = subprocess.run(cmd)
    if result.returncode != 0:
        print("fontTools.subset 失败", file=sys.stderr)
        return result.returncode

    print(
        f"图标子集完成：{os.path.getsize(SRC) / 1024:.0f} KB → "
        f"{os.path.getsize(OUT) / 1024:.0f} KB，"
        f"候选名 {len(names)}，命中连字 {len(found)}，字形 {len(glyphs)}"
    )
    print(f"输出：{OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
