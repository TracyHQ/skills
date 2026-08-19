#!/usr/bin/env bash
# Shared single-emit guard for C1 diagnostic scripts that change a copy.
# One concern: exactly one envelope reaches stdout, even when the run dies
# somewhere it never planned to, and temp files never outlive the run.
# Source order: source result-envelope.sh FIRST — the trap here calls its
# envelope_error / envelope_emit. Sourced as a library, so it sets no flags.
#
# Caller contract:
#   ENVELOPE_ABORT_NOTE="<what may be left half-done>"   # before the trap
#   trap on_exit EXIT
#   envelope_init …; ENVELOPE_READY=1
#   TEMP_FILES+=("$f")                                    # anything to clean up

ENVELOPE_READY=0
ENVELOPE_EMITTED=0
TEMP_FILES=()

# Names, in the abort message, the state the copy may have been left in. Each
# script says this in its own terms, so the agent reading the envelope knows
# what it may have to undo.
ENVELOPE_ABORT_NOTE="the copy may be left mid-change"

emit_envelope_once() {
  (( ENVELOPE_EMITTED == 1 )) && return 0
  ENVELOPE_EMITTED=1
  envelope_emit
}

# A mid-run failure would otherwise leave the copy changed and print nothing at
# all — the one state an agent cannot reverse, because it never learnt of it.
# Usage errors exit before the envelope exists and stay silent by design.
on_exit() {
  local rc=$?
  local f
  for f in ${TEMP_FILES[@]+"${TEMP_FILES[@]}"}; do
    if [[ -n "$f" ]]; then rm -f "$f"; fi
  done
  if (( rc != 0 && ENVELOPE_READY == 1 && ENVELOPE_EMITTED == 0 )); then
    envelope_error "Run aborted unexpectedly (exit $rc); $ENVELOPE_ABORT_NOTE"
    emit_envelope_once
    exit 0
  fi
}
