#!/usr/bin/env bash
# 用法: 把本脚本和 spaceflight-simulator-i18n.zip 放在同一目录，在仓库里直接运行 ./deploy.sh 即可
# 可选参数: ./deploy.sh [zip文件] [仓库地址或本地目录] [分支]
# 解压 zip → 覆盖进仓库分支（只新增/覆盖，不删除）→ 提交 → 推送
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ZIP="${1:-$SCRIPT_DIR/spaceflight-simulator-i18n.zip}"
REPO="${2:-.}"   # 默认：当前目录（你已经在仓库里）
BRANCH="${3:-feature/threejs-sfs-module-1}"
MSG="${COMMIT_MSG:-feat(i18n): add zh/en language switch + tests}"
YES="${YES:-0}"   # YES=1 时跳过推送确认

[ -f "$ZIP" ] || { echo "找不到 zip: $ZIP" >&2; exit 1; }
command -v unzip >/dev/null || { echo "需要安装 unzip" >&2; exit 1; }
ZIP="$(cd "$(dirname "$ZIP")" && pwd)/$(basename "$ZIP")"

# 1) 取得仓库
if [ -d "$REPO/.git" ]; then
  cd "$REPO"
else
  DIR="$(basename "$REPO" .git)"
  [ -d "$DIR/.git" ] || git clone "$REPO" "$DIR"
  cd "$DIR"
fi
[ -z "$(git status --porcelain -- . ':!deploy.sh' ':!*.zip')" ] || { echo "工作区有未提交改动，请先提交或 stash。" >&2; exit 1; }

# 2) 切到目标分支（远端有就跟踪，没有就新建）
git fetch origin
if git show-ref --verify --quiet "refs/remotes/origin/$BRANCH"; then
  git checkout "$BRANCH"
  git pull --rebase origin "$BRANCH"
else
  git checkout -B "$BRANCH"
fi

# 3) 解压到临时目录；若 zip 只有一层顶级目录则自动进入
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
unzip -q "$ZIP" -d "$TMP" -x "__MACOSX/*" "*/node_modules/*" "node_modules/*"
SRC="$TMP"
if [ "$(ls -A "$TMP" | wc -l)" -eq 1 ] && [ -d "$TMP/$(ls -A "$TMP")" ]; then SRC="$TMP/$(ls -A "$TMP")"; fi

# 4) 复制（不使用 --delete，不会删除仓库已有文件）
cp -a "$SRC"/. .

# 5) 查看改动并提交
git add -A
git reset -q -- deploy.sh "$(basename "$ZIP")" 2>/dev/null || true   # 脚本和 zip 本身不提交
if git diff --cached --quiet; then echo "没有任何改动，无需提交。"; exit 0; fi
git status --short
if [ "$YES" != "1" ]; then
  read -r -p "确认提交并推送到 origin/$BRANCH ? [y/N] " a
  [ "$a" = "y" ] || [ "$a" = "Y" ] || { echo "已取消（文件已复制并暂存，未提交）。"; exit 1; }
fi
git commit -m "$MSG"
git push -u origin "$BRANCH"
echo "完成：已推送到 origin/$BRANCH"
