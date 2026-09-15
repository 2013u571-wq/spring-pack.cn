# 七牛云对象存储部署

本项目是纯静态 Astro 站点。推送 `main` 分支后，GitHub Actions 会构建 `dist/` 并上传到七牛云 Kodo。

## 七牛云设置

1. 创建或选择一个对象存储空间，记住空间名和存储区域。
2. 开启静态网站托管，默认首页设为 `index.html`。
3. 绑定 `spring-pack.cn` 的 CDN 加速域名并配置 HTTPS。
4. 如使用了已有空间，请先确认空间中的同名文件可以被新站点覆盖。部署脚本不会删除其他对象。

## GitHub Actions Secrets

在 GitHub 仓库的 **Settings → Secrets and variables → Actions** 中添加：

- `QINIU_ACCESS_KEY`：七牛云 AccessKey。
- `QINIU_SECRET_KEY`：七牛云 SecretKey。
- `QINIU_BUCKET`：对象存储空间名。
- `QINIU_ZONE`：存储区域，可用 `z0`、`z1`、`z2`、`na0`、`as0` 或 `cn-east-2`。
- `QINIU_CDN_REFRESH_DIRS`：可选，例如 `https://spring-pack.cn/`。
- `QINIU_CDN_REFRESH_URLS`：可选，多个 URL 用逗号或换行分隔。

AccessKey 和 SecretKey 只能保存在 GitHub Secrets，不得写入仓库文件。

## 手动触发

打开 GitHub 仓库的 **Actions → Deploy to Qiniu Kodo → Run workflow**。
如必填 Secrets 尚未设置，流水线会完成构建检查并安全跳过上传。

本地验证命令：

```bash
npm ci
npm run build
```
