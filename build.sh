#!/bin/sh
# バージョン情報を git から自動生成して js/version.js に書き出す
# デプロイ前に実行: sh build.sh

VERSION=$(git describe --tags --always 2>/dev/null || echo "dev")
DATE=$(git log -1 --format="%ci" | cut -c1-10)

cat > js/version.js <<EOF
'use strict';
const APP_VERSION = '${VERSION}';
const APP_UPDATED = '${DATE}';
EOF

echo "Generated js/version.js: v${VERSION} (${DATE})"
