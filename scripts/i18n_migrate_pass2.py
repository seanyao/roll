#!/usr/bin/env python3
"""US-I18N-002 second pass: handle remaining bilingual/Chinese strings that the
first pass missed due to $() command substitution, printf format strings, and
Chinese-only lines.
"""

import re
import os
from pathlib import Path

ROLL_DIR = Path(__file__).resolve().parent.parent
BIN_ROLL = ROLL_DIR / 'bin' / 'roll'
I18N_DIR = ROLL_DIR / 'lib' / 'i18n'

def is_chinese(ch):
    return '\u4e00' <= ch <= '\u9fff'

def contains_chinese(s):
    return any(is_chinese(c) for c in s)

# ── Smart string extraction with $() awareness ──
def extract_first_dq(line):
    """Extract first double-quoted string, ignoring quotes inside $(...)."""
    depth = 0  # $() nesting
    in_str = False
    start = -1
    i = 0
    while i < len(line):
        c = line[i]
        # Track $() depth
        if c == '$' and i+1 < len(line) and line[i+1] == '(':
            if not in_str:
                depth += 1
            i += 2
            continue
        if depth > 0:
            if c == '(':
                depth += 1
            elif c == ')':
                depth -= 1
            i += 1
            continue
        # Outside $(), handle quotes
        if c == '"' and (i == 0 or line[i-1] != '\\'):
            if not in_str:
                in_str = True
                start = i + 1
            else:
                return line[start:i], start, i
        i += 1
    return None, -1, -1

def find_zh_boundary(s):
    """Find where Chinese starts after EN part."""
    for i, ch in enumerate(s):
        if is_chinese(ch):
            j = i - 1
            while j >= 0 and s[j] == ' ':
                j -= 1
            en_part = s[:j+1]
            zh_part = s[i:]
            return en_part, zh_part
    return None, None

def extract_vars_single_pass(s):
    """Extract bash vars, dedup, replace with %s. Single pass."""
    vars_found = []
    seen = set()
    
    def replace_var(m):
        full = m.group(0)
        if full.startswith('$(') or full.startswith('${!') or full in ('$*', '$@', '$#', '$?'):
            return full
        if full not in seen:
            seen.add(full)
            vars_found.append(full)
        return '%s'
    
    clean = re.sub(r'\$\{[^}]+\}|\$[A-Za-z_][A-Za-z0-9_]*', replace_var, s)
    return clean, vars_found

def slugify(text, max_len=50):
    clean = re.sub(r'\$\{[^}]+\}', '', text)
    clean = re.sub(r'\$[A-Za-z_][A-Za-z0-9_]*', '', clean)
    words = re.findall(r'[A-Za-z0-9]+', clean.lower())
    slug = '_'.join(words[:6])
    if len(slug) > max_len:
        slug = slug[:max_len].rstrip('_')
    return slug

def find_commands(lines):
    cmds = []
    for i, line in enumerate(lines):
        m = re.match(r'^(cmd_\w+)\(\)\s*\{?\s*$', line)
        if m:
            cmds.append({'name': m.group(1), 'start': i})
    for j in range(len(cmds)):
        cmds[j]['end'] = cmds[j+1]['start'] if j+1 < len(cmds) else len(lines)
    return cmds

def get_cmd_name(commands, line_no):
    for cmd in commands:
        if cmd['start'] <= line_no < cmd['end']:
            return cmd['name']
    return 'cmd_shared'

def make_en_translation(zh_text):
    """Generate a simple EN translation fallback for Chinese-only strings.
    This is a placeholder — actual translations should be done by a human."""
    # Basic mapping for common patterns
    mapping = {
        '未检测到 AI agent。请先安装 (如 claude / codex / kimi) 后重试。': 
            'No AI agent detected. Install one (e.g., claude, codex, kimi) and try again.',
        '后续过程会使用你的 agent 调用模型，token 消耗在你自己的账户上。':
            'The process will use your agent to call models. Token cost is on your own account.',
        '代码与对话都留在你的 agent 工具里 —— Roll 本身不上传任何内容。':
            'Code and conversations stay in your agent tool — Roll does not upload anything.',
        '在 agent 内用 /exit 结束（或 Ctrl-C）。退出后 Roll 会自动衔接 apply。':
            'Use /exit to end (or Ctrl-C). Roll will auto-apply after exit.',
        '对话完成后再次运行 `roll init` 即可。':
            'After the conversation, run `roll init` again.',
        '请先在 AI agent 里运行 $roll-onboard 生成 plan，再回来执行 apply。':
            'Run $roll-onboard in your AI agent first, then come back to apply.',
        '拒绝处理 \'%s\' — 路径不在当前项目下，可能是误用':
            'Refusing to process \'%s\' — path is outside current project, possible misuse',
        '变更清单为空，无需 offboard。':
            'Change list is empty, nothing to offboard.',
        '以上为预演结果。加 --confirm 后才会真正执行。':
            'Above is a dry-run preview. Add --confirm to execute.',
        '启动 peer review: %s → %s (第 %s 轮, tag: %s)':
            'Starting peer review: %s → %s (round %s, tag: %s)',
        '按 Enter 执行或输入 n 取消。%s 秒后自动执行...':
            'Press Enter to run or n to cancel. Auto-executing in %s...',
        '观察：tmux 会话 + 终端弹窗 + stream-json 事件流':
            'Observing: tmux session + terminal popup + stream-json event stream',
        '运行 \'roll alert ack\' 确认告警，\'roll alert resolve\' 清除告警。':
            'Run \'roll alert ack\' to acknowledge alerts, \'roll alert resolve\' to clear.',
        '可选值: zh, en, --reset':
            'Options: zh, en, --reset',
        '提示：先运行 \'roll slides new "<主题>"\' 生成新的幻灯片。':
            'Tip: run \'roll slides new "<topic>"\' to generate a new slideshow.',
        '提示：运行 \'roll slides new "<主题>"\' 创建第一个幻灯片。':
            'Tip: run \'roll slides new "<topic>"\' to create your first slideshow.',
        '提示：先运行 \'roll slides build %s\' 渲染幻灯片。':
            'Tip: run \'roll slides build %s\' to render the slideshow.',
        '用法: roll slides build <slug> [--no-open]':
            'Usage: roll slides build <slug> [--no-open]',
        '未找到 deck 文件：%s':
            'Deck file not found: %s',
        '用法: roll slides preview <slug> [--no-open]':
            'Usage: roll slides preview <slug> [--no-open]',
        '未找到已渲染的 HTML：%s':
            'Rendered HTML not found: %s',
        '用法: roll slides logs <slug>':
            'Usage: roll slides logs <slug>',
        '用法: roll slides delete <slug> [--force]':
            'Usage: roll slides delete <slug> [--force]',
        '无法从主题派生 slug：%s':
            'Cannot derive slug from topic: %s',
        '下一步：roll slides build %s':
            'Next: roll slides build %s',
        '用法：roll slides new "<主题>" [--template <模板名>] [--quiet] [--no-build]':
            'Usage: roll slides new "<topic>" [--template <name>] [--quiet] [--no-build]',
        '用法: roll alert [list|ack|resolve]':
            'Usage: roll alert [list|ack|resolve]',
        '用法:  roll <command> [options]':
            'Usage:  roll <command> [options]',
        '每小時 :%02d':
            'Hourly at :%02d',
        '每%d分鐘 (%s)':
            'Every %d min (%s)',
        '选一个 agent  Pick an agent:':
            'Pick an agent:',
        'Available agents  可用 agent:':
            'Available agents:',
    }
    
    # Try exact match first
    if zh_text in mapping:
        return mapping[zh_text]
    
    # Try matching after stripping leading/trailing spaces
    stripped = zh_text.strip()
    if stripped in mapping:
        return mapping[stripped]
    
    # For format strings, try matching the template
    for pattern, translation in mapping.items():
        if '%' in pattern:
            # Convert pattern to regex
            regex = re.escape(pattern).replace(r'\%s', r'.+?').replace(r'\%d', r'\d+?')
            if re.match('^' + regex + '$', stripped):
                return translation
    
    return f"[EN:{zh_text[:50]}...]"

def main():
    dry_run = '--dry-run' in sys.argv
    
    with open(BIN_ROLL) as f:
        lines = f.readlines()
    
    commands = find_commands(lines)
    catalog = {}  # cmd -> [(key, en, zh, vars)]
    modifications = []
    
    for line_no, line in enumerate(lines):
        if not contains_chinese(line):
            continue
        
        # Skip comments, variable assignments, already migrated
        stripped = line.strip()
        if stripped.startswith('#'):
            continue
        if re.match(r'^\s*\w+=', line) and not '"' in line:
            continue
        if '$(msg ' in line:
            continue
        
        # Check if line is a user-facing output (echo/info/ok/warn/err/printf)
        is_output = bool(re.search(r'\b(echo|info|ok|warn|err|printf)\b', line))
        if not is_output:
            continue
        
        cmd_name = get_cmd_name(commands, line_no)
        
        # Try DQ extraction
        content, qstart, qend = extract_first_dq(line)
        if content is None:
            # Try single-quoted string
            sq_match = re.search(r"'([^']*)'", line)
            if sq_match:
                content, qstart, qend = sq_match.group(1), sq_match.start(1) - 1, sq_match.end(1)
        
        if content is None or not contains_chinese(content):
            continue
        
        en_part, zh_part = find_zh_boundary(content)
        
        if en_part and zh_part:
            # Bilingual in one string
            en_part = en_part.rstrip()
            zh_part = zh_part.lstrip()
        else:
            # Chinese-only — need to generate EN translation
            zh_part = content
            en_part = make_en_translation(zh_part)
        
        if not zh_part:
            continue
        
        en_clean, en_vars = extract_vars_single_pass(en_part)
        zh_clean, zh_vars = extract_vars_single_pass(zh_part)
        all_vars = list(dict.fromkeys(en_vars + zh_vars))
        
        slug = slugify(en_part)
        if not slug:
            slug = slugify(zh_part)
        key = f"{cmd_name[len('cmd_'):]}.{slug}"
        
        catalog_list = catalog.setdefault(cmd_name, [])
        existing_keys = {k for k, _, _, _ in catalog_list}
        counter = 2
        base_key = key
        while key in existing_keys:
            key = f"{base_key}_{counter}"
            counter += 1
        catalog_list.append((key, en_clean, zh_clean, all_vars))
        
        before = line[:qstart]
        after = line[qend+1:]
        
        var_args = ' '.join(all_vars)
        if var_args:
            replacement_line = f'{before}$(msg {key} {var_args})"{after}'
        else:
            replacement_line = f'{before}$(msg {key})"{after}'
        
        modifications.append((line_no, line, replacement_line, cmd_name, key))
    
    if modifications:
        print(f"Second pass: {len(modifications)} additional strings\n")
        for line_no, orig, new, cmd_name, key in modifications[:10]:
            print(f"  Line {line_no+1} [{cmd_name}]:")
            print(f"    OLD: {orig.rstrip()[:120]}")
            print(f"    NEW: {new.rstrip()[:120]}")
        
        if not dry_run:
            for line_no, orig, new, cmd_name, key in reversed(modifications):
                lines[line_no] = new
            
            # Write catalog
            for cmd_name, entries in catalog.items():
                cat_file = 'shared.sh' if cmd_name == 'cmd_shared' else f"{cmd_name[len('cmd_'):]}.sh"
                filepath = I18N_DIR / cat_file
                existing = set()
                if filepath.exists():
                    for l in filepath.read_text().splitlines(True):
                        m = re.match(r"_i18n_set \w+ ([\w.]+)", l)
                        if m:
                            existing.add(m.group(1))
                
                new_entries = []
                for key, en_text, zh_text, var_list in entries:
                    if key not in existing:
                        new_entries.append(f'_i18n_set en {key} "{en_text}"\n')
                        new_entries.append(f'_i18n_set zh {key} "{zh_text}"\n')
                
                if new_entries:
                    with open(filepath, 'a') as f:
                        f.write('\n')
                        f.writelines(new_entries)
                    print(f"  +{len(new_entries)//2} entries to {cat_file}")
            
            with open(BIN_ROLL, 'w') as f:
                f.writelines(lines)
            print("\nSecond pass applied.")
    else:
        print("No additional strings found.")

if __name__ == '__main__':
    import sys
    main()
