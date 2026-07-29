#!/bin/bash
# Install dependencies at session start.
#
# This deliberately lives in a SessionStart hook rather than a cloud
# environment's setup script: that script runs before the repository is
# cloned, so npm finds no package.json and the session fails to start with
# ENOENT on /home/user/package.json.
#
# Always exits 0. A session that cannot install dependencies is still a
# session worth having — Claude can run npm install itself and say so.

set -u

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

# Already installed. Nothing to do, and this runs on every resume.
if [ -d node_modules ]; then
  exit 0
fi

npm install --no-audit --no-fund || true
exit 0
