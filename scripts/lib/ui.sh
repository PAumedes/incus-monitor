# SPDX-License-Identifier: GPL-2.0-or-later
# Readable output for the build and check scripts. Source it; it prints nothing by itself.
#
# Colour only on a terminal, decided per stream (ui_fail writes to stderr, the rest to stdout),
# never with NO_COLOR, CI or a dumb TERM. Emoji only with colour and a UTF-8 locale; otherwise
# each level keeps a distinct ASCII tag. Control characters in a message are replaced by `?` so
# that text from a tool or a file name cannot drive the terminal.
# UI_T0 (epoch seconds) lets `make` start the clock for the elapsed time of ui_done.
# UI_BOLD, UI_CYAN and UI_RESET hold the escapes for stdout (empty when it is plain), so
# `make help` styles itself the same way.

# usage: _ui_style <fd>; sets _ui_color and _ui_emoji for that stream.
_ui_style() {
    _ui_color=0
    _ui_emoji=0
    if [[ -t $1 && -z ${NO_COLOR:-} && -z ${CI:-} && -n ${TERM:-} && ${TERM:-} != dumb ]]; then
        _ui_color=1
        case ${LC_ALL:-${LC_CTYPE:-${LANG:-}}} in
            *[Uu][Tt][Ff]-8* | *[Uu][Tt][Ff]8*) _ui_emoji=1 ;;
        esac
    fi
}

UI_BOLD='' UI_CYAN='' UI_RESET=''
_ui_style 1
if ((_ui_color)); then
    UI_BOLD=$'\e[1m' UI_CYAN=$'\e[36m' UI_RESET=$'\e[0m'
fi

printf -v _ui_now '%(%s)T' -1
_ui_t0=$_ui_now
if [[ ${UI_T0:-} =~ ^[0-9]{1,10}$ ]] && ((10#$UI_T0 <= _ui_now)); then
    _ui_t0=$((10#$UI_T0))
fi

# usage: _ui_line <fd> <ansi colour> <ascii tag> <emoji> <message>
_ui_line() {
    local fd=$1 tag=$3 message=${5//[[:cntrl:]]/?}
    _ui_style "$fd"
    if ((_ui_emoji)); then
        tag=$4
    fi
    if ((_ui_color)); then
        printf '\e[%sm%s\e[0m %s\n' "$2" "$tag" "$message" >&"$fd"
    else
        printf '%s %s\n' "$tag" "$message" >&"$fd"
    fi
}

ui_step() { _ui_line 1 '1;34' '==>' '🔧' "$*"; }
ui_info() { _ui_line 1 '36' '-' '💬' "$*"; }
ui_ok() { _ui_line 1 '32' 'ok:' '✅' "$*"; }
ui_warn() { _ui_line 1 '33' 'warn:' '⚠️ ' "$*"; }
ui_fail() { _ui_line 2 '31' 'error:' '❌' "$*"; }

ui_done() {
    local now elapsed
    printf -v now '%(%s)T' -1
    elapsed=$((now - _ui_t0))
    if ((elapsed >= 60)); then
        elapsed="$((elapsed / 60))min $((elapsed % 60))s"
    else
        elapsed="${elapsed}s"
    fi
    _ui_line 1 '1;32' 'done:' '🏁' "$* ($elapsed)"
}
