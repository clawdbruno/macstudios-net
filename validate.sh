#!/bin/sh
# Validation gate for macstudios.net — run before every deploy (the monthly
# refresh routine uses this too). Exits non-zero on any failure.
set -e
cd "$(dirname "$0")"

echo "== 1/3 syntax gate =="
python3 -c "
import re
s = open('index.html').read()
m = re.search(r'<script>(.*)</script>', s, re.S)
open('/tmp/msllm-gate.js', 'w').write(m.group(1))
"
node --check /tmp/msllm-gate.js
echo "   OK"

echo "== 2/3 regenerate static pages =="
node build-seo.mjs

echo "== 3/3 artifact sanity =="
PAGES=$(ls run/ | wc -l | tr -d ' ')
SITEMAP=$(grep -c "<loc>" sitemap.xml)
echo "   run/ pages: $PAGES · sitemap URLs: $SITEMAP"
[ "$SITEMAP" -eq $((PAGES + 1)) ] || { echo "FAIL: sitemap/page count mismatch"; exit 1; }
grep -q "embed.html" -r run/ 2>/dev/null || true
echo "ALL GATES PASSED"
