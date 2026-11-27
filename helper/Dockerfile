# The AI helper (helper/): a small Node server that runs Claude Code headless, with all its tools off,
# for each AI job. GitHub Actions builds and publishes ghcr.io/nandminc/aw-study-ai:main on every push
# to main (.github/workflows/publish.yml). Run it with a read-only filesystem and a small tmpfs at
# /tmp: each request gets a fresh home folder there, deleted afterwards. No volumes.
#
# Debian (slim), not Alpine: Claude Code's native parts want glibc.
FROM node:24-slim

# Claude Code, pinned: upgrade on purpose (and run the tests), never by surprise. Its own updater
# is off (DISABLE_AUTOUPDATER in helper/claude.mjs), and the filesystem is read-only anyway.
RUN npm install -g @anthropic-ai/claude-code@2.1.327 \
 && npm cache clean --force \
 && claude --version

WORKDIR /app
COPY access.mjs app.mjs claude.mjs jobs.mjs queue.mjs reading.mjs rounds.mjs seal.mjs server.mjs ./

ENV NODE_ENV=production \
    PORT=3001 \
    TMPDIR=/tmp

# Files owned by root and readable by everyone; it runs as the unprivileged `node` user
USER node
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3001/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

CMD ["node", "server.mjs"]
