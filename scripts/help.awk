# SPDX-License-Identifier: GPL-2.0-or-later
# Renders `make help` from the Makefile: quick start, ## target descriptions grouped by ##@
# section, and the ##? variables. -v bold=, cyan= and reset= take the escapes (empty for plain).
function heading(text) {
    printf "\n%s%s%s\n", bold, text, reset
}
BEGIN {
    heading("Quick start")
    print "    make doctor      check that this machine has the tools"
    print "    make test-all    run the unit, tooling and GJS tests"
    print "    make zip         build the extension zip"
}
/^##@ / { heading(substr($0, 5)) }
/^[a-z0-9-]+:.*## / {
    split($0, parts, /:.*## /)
    printf "  %s%-20s%s %s\n", cyan, parts[1], reset, substr($0, index($0, "## ") + 3)
}
/^##\? / { variables = variables sprintf("  %s\n", substr($0, 5)) }
END {
    heading("Variables (make <target> NAME=value)")
    printf "%s", variables
}
