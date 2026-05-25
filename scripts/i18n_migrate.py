#!/usr/bin/env python3
"""US-I18N-002: Migrate bin/roll bilingual strings to msg() catalog.

Reads bin/roll, extracts all "EN text  中文" patterns within command
functions, generates catalog entries in lib/i18n/<command>.sh, and
replaces the original lines with msg() calls.

Strategy: parse line-by-line within known command boundaries.
For each line containing Chinese chars inside a quoted string used with
echo/info/ok/warn/err, extract EN+ZH parts, generate a stable key,
and produce replacements.
"""

import re
import os
import sys
from pathlib import Path

ROLL_DIR = Path(__file__).resolve().parent.parent
BIN_ROLL = ROLL_DIR / 'bin' / 'roll'
I18N_DIR = ROLL_DIR / 'lib' / 'i18n'

# Command boundaries: start_line -> { name, end_line }
# We'll reparse on every run.

def is_chinese(ch):
    return '\u4e00' <= ch <= '\u9fff'

def contains_chinese(s):
    return any(is_chinese(c) for c in s)

def extract_string_content(line):
    """Extract the content inside first double-quoted string."""
    # Match a double-quoted string, handling escaped quotes
    in_str = False
    start = -1
    for i, c in enumerate(line):
        if c == '"' and (i == 0 or line[i-1] != '\\'):
            if not in_str:
                in_str = True
                start = i + 1
            else:
                return line[start:i], start, i
    return None, -1, -1

def find_zh_boundary(s):
    """Find the position where Chinese text starts (after EN part).
    
    Looks for the pattern: space + Chinese, typically 2+ spaces.
    """
    for i, ch in enumerate(s):
        if is_chinese(ch):
            # Walk back to find the separator boundary
            j = i - 1
            while j >= 0 and s[j] == ' ':
                j -= 1
            # j is at last non-space before Chinese
            # The separator is j+1 to i
            en_part = s[:j+1]
            zh_part = s[i:]
            return en_part, zh_part
    return None, None

def extract_vars(s):
    """Extract bash variable patterns and return (clean_template, var_list).
    
    Replaces ${var}, $var with %s placeholders.
    """
    # This is simplified - full bash variable parsing is complex
    # We look for: ${...} and $var patterns
    vars_found = []
    
    # Single-pass: replace all variable patterns with %s
    # Match ${var} first (longer), then $var
    seen_vars = set()
    def replace_var(match):
        full = match.group(0)
        if full.startswith('$('):
            return full  # don't replace command substitution
        if full == '$*' or full == '$@' or full == '$#' or full == '$?':
            return full  # special vars
        if full not in seen_vars:
            seen_vars.add(full)
            vars_found.append(full)
        return '%s'
    
    # Order: ${...} before $var (more specific pattern first)
    clean = re.sub(r'\$\{[^}]+\}|\$[A-Za-z_][A-Za-z0-9_]*', replace_var, s)
    
    return clean, vars_found

def slugify(text, max_len=50):
    """Create a readable key segment from English text."""
    # Strip variable patterns like ${var} and $var before slugifying
    clean = re.sub(r'\$\{[^}]+\}', '', text)
    clean = re.sub(r'\$[A-Za-z_][A-Za-z0-9_]*', '', clean)
    # Take first few words, lowercase, replace non-alnum with underscore
    words = re.findall(r'[A-Za-z0-9]+', clean.lower())
    slug = '_'.join(words[:6])
    if len(slug) > max_len:
        slug = slug[:max_len].rstrip('_')
    return slug

def find_command_boundaries(lines):
    """Find start/end lines for each cmd_* function."""
    commands = []
    for i, line in enumerate(lines):
        m = re.match(r'^(cmd_\w+)\(\)\s*\{?\s*$', line)
        if m:
            commands.append({'name': m.group(1), 'start': i})
    
    # Set end lines
    for j in range(len(commands)):
        if j + 1 < len(commands):
            commands[j]['end'] = commands[j+1]['start']
        else:
            commands[j]['end'] = len(lines)
    
    return commands

def get_command_for_line(commands, line_no):
    """Return command name for a given line number."""
    for cmd in commands:
        if cmd['start'] <= line_no < cmd['end']:
            return cmd['name']
    return 'cmd_shared'

def process_file(lines):
    """Process bin/roll lines, return (new_lines, catalog_entries).
    
    catalog_entries: dict of command_name -> [(key, en_text, zh_text, var_list)]
    """
    commands = find_command_boundaries(lines)
    new_lines = list(lines)
    catalog = {}  # cmd_name -> [(key, en_text, zh_text, var_list)]
    
    modifications = []  # list of (line_no, original, new, cmd, key)
    
    for line_no, line in enumerate(lines):
        if not contains_chinese(line):
            continue
        
        # Skip lines that already use msg()
        if 'msg ' in line and '$(' in line:
            continue
        
        # Skip lines that are just variable definitions
        if re.match(r'^\s*\w+=', line):
            continue
        
        # Skip version strings, comments
        stripped = line.strip()
        if stripped.startswith('#'):
            continue
        if stripped.startswith('VERSION='):
            continue
        
        # Extract double-quoted string content
        content, qstart, qend = extract_string_content(line)
        if content is None:
            continue
        
        if not contains_chinese(content):
            continue
        
        # Try to split at EN/ZH boundary
        en_part, zh_part = find_zh_boundary(content)
        if en_part is None:
            continue
        
        # Clean up trailing/leading spaces
        en_part = en_part.rstrip()
        zh_part = zh_part.lstrip()
        
        if not en_part or not zh_part:
            continue
        
        # Get command context
        cmd_name = get_command_for_line(commands, line_no)
        
        # Extract variables and create template
        en_clean, en_vars = extract_vars(en_part)
        zh_clean, zh_vars = extract_vars(zh_part)
        
        # Merge and deduplicate variables (same var may appear in both EN and ZH)
        all_vars = list(dict.fromkeys(en_vars + zh_vars))  # order-preserving dedup
        
        # Generate key
        slug = slugify(en_part)
        if not slug:
            slug = slugify(zh_part)
        key = f"{cmd_name[len('cmd_'):]}.{slug}"
        
        # Ensure key uniqueness
        catalog_list = catalog.setdefault(cmd_name, [])
        # Check for duplicate keys
        existing_keys = {k for k, _, _, _ in catalog_list}
        counter = 2
        base_key = key
        while key in existing_keys:
            key = f"{base_key}_{counter}"
            counter += 1
        
        catalog_list.append((key, en_clean, zh_clean, all_vars))
        
        # Build replacement
        # The line has: ... "..." ... (before the quote and after)
        before = line[:qstart]
        after = line[qend+1:]  # includes the closing " and everything after
        
        # Build the msg call
        var_args = ' '.join(all_vars)
        if var_args:
            replacement_line = f'{before}$(msg {key} {var_args})"{after}'
        else:
            replacement_line = f'{before}$(msg {key})"{after}'
        
        modifications.append((line_no, line, replacement_line, cmd_name, key))
    
    # Apply modifications (reverse order to preserve line numbers)
    for line_no, orig, replacement, cmd_name, key in modifications:
        new_lines[line_no] = replacement
    
    return new_lines, catalog, modifications

def write_catalog_files(catalog):
    """Write catalog entries to lib/i18n/<command>.sh files."""
    I18N_DIR.mkdir(parents=True, exist_ok=True)
    
    for cmd_name, entries in catalog.items():
        if cmd_name == 'cmd_shared':
            catalog_file = 'shared.sh'
        else:
            catalog_file = f"{cmd_name[len('cmd_'):]}.sh"
        
        filepath = I18N_DIR / catalog_file
        
        # Read existing content to preserve non-duplicate entries
        existing_lines = []
        existing_keys = set()
        if filepath.exists():
            existing_lines = filepath.read_text().splitlines(True)
            for line in existing_lines:
                m = re.match(r"_i18n_set \w+ ([\w.]+)", line)
                if m:
                    existing_keys.add(m.group(1))
        
        # Build new entries (only for keys not already present)
        new_entries = []
        for key, en_text, zh_text, var_list in entries:
            if key not in existing_keys:
                new_entries.append(f'_i18n_set en {key} "{en_text}"\n')
                new_entries.append(f'_i18n_set zh {key} "{zh_text}"\n')
        
        if new_entries:
            # Append to file
            with open(filepath, 'a') as f:
                f.write('\n')
                f.writelines(new_entries)
            print(f"  Wrote {len(new_entries)//2} entries to {catalog_file}")

def main():
    dry_run = '--dry-run' in sys.argv
    
    print(f"Reading {BIN_ROLL}...")
    with open(BIN_ROLL) as f:
        lines = f.readlines()
    
    print(f"Processing {len(lines)} lines...")
    new_lines, catalog, modifications = process_file(lines)
    
    print(f"Found {len(modifications)} bilingual strings across {len(catalog)} commands:\n")
    
    for cmd_name, entries in sorted(catalog.items()):
        print(f"  {cmd_name}: {len(entries)} strings")
    
    if modifications:
        print(f"\nSample modifications (first 5):")
        for line_no, orig, new, cmd_name, key in modifications[:5]:
            print(f"  Line {line_no+1} [{cmd_name}]:")
            print(f"    OLD: {orig.rstrip()[:120]}")
            print(f"    NEW: {new.rstrip()[:120]}")
            print(f"    KEY: {key}")
    
    if dry_run:
        print("\n(Dry run — no files modified)")
        return
    
    print("\nWriting catalog entries...")
    write_catalog_files(catalog)
    
    print(f"\nWriting updated {BIN_ROLL}...")
    with open(BIN_ROLL, 'w') as f:
        f.writelines(new_lines)
    
    print("Done!")

if __name__ == '__main__':
    main()
