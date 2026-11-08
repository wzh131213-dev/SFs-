# 安全 ZIP 解压工作流

本目录为仓库 `feature/threejs-sfs-module-1` 分支提供 GitHub Actions 自动解压流程。它只生成 Actions Artifact，不会自动把解压内容提交回仓库，避免意外覆盖航天模拟器源码。

## 使用方法

### 方法一：提交 ZIP 自动触发
1. 在仓库根目录创建 `incoming/`。
2. 把一个或多个 ZIP 文件放进 `incoming/`，并提交到 `feature/threejs-sfs-module-1`。
3. 打开 GitHub 仓库的 **Actions → Safe ZIP Extractor**。
4. 等待任务完成，在运行记录的 **Artifacts** 区域下载 `extracted-archives-<运行编号>`。

### 方法二：手动指定仓库内的 ZIP
1. 打开 **Actions → Safe ZIP Extractor → Run workflow**。
2. 可在 `archive_path` 填写仓库内路径，例如 `incoming/spaceflight-simulator-i18n.zip`。
3. 留空则批量处理 `incoming/` 下所有 ZIP。
4. 运行完成后下载 Artifact。

## 本地运行

需要 Python 3.9+：

```bash
python scripts/safe_unzip.py incoming/example.zip --output extracted
```

## 安全与完整性检查

- 使用 ZIP 文件头识别，不只依赖扩展名；非 ZIP、截断包和 CRC 错误会失败。
- 解压前检查全部条目，拒绝绝对路径、`..` 路径穿越、Windows 盘符路径、符号链接和加密条目。
- 限制单文件 512 MiB、总解压大小 2 GiB、条目数 100,000，并拒绝异常压缩率。
- 不覆盖已存在的同名输出目录；解压中途失败会清理本次半成品目录。
- 生成 `extracted/unzip-report.json`，记录每个压缩包的成功或失败状态。
- 原 ZIP 文件不会被删除或修改。

## 注意事项

- 仅处理已经提交到 Git 仓库的 ZIP；GitHub Actions 不会直接读取 iPad 本地文件。
- Artifact 默认保留 14 天。
- 这是“解压并提供下载产物”的工作流，不会自动合并解压文件到游戏源码目录。确认文件内容后，再人工挑选合并更安全。
