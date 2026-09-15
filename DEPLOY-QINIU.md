# 通过 GitHub 部署到七牛云 LAS

本项目是 Astro 服务端站点，包含 `/api/contact`。七牛云 Kodo 对象存储只能托管静态文件，因此这里使用 LAS「一键部署」的 GitHub 仓库部署功能。构建配置在 `.qiniu/deploy.yaml`。

## 部署步骤

1. 将此目录推送到**公开** GitHub 仓库的 `main` 分支。`.env`、`node_modules` 和构建产物已由 `.gitignore` 排除。不要把密钥提交到 GitHub。
2. 登录[七牛云 LAS 控制台](https://portal.qiniu.com/las)，进入「一键部署」→「新建部署」。填写 GitHub 仓库地址或 `owner/repository`，选择 `main`，配置路径使用 `.qiniu/deploy.yaml`。
3. 选择可用的 Sandbox 区域和模板，核对计费并创建部署。七牛 `base` 模板的系统 Node 版本较旧，且 Linux 可选二进制依赖需要在目标环境解析，因此项目会先通过 `npm install --no-audit --no-fund` 安装固定的 Node 22.22.0 运行时，再用该运行时构建和启动服务；服务监听 `0.0.0.0:3000`，平台检查 `/`。
4. Revision 状态变成 `ready` 后，打开七牛提供的服务地址，检查首页、产品页、图片与联系页面。若失败，在该 Revision 日志中查看出错阶段。

七牛云当前的一键部署仅支持公开仓库和 Sandbox，**GitHub Push 不会自动更新已部署的 Revision**。每次发布新提交后，需要在控制台手动重新部署。Sandbox 会按资源与运行时长计费。站点 canonical、Open Graph 和 Sitemap 已统一使用 `https://spring-pack.cn`；如果最终域名改变，需要同步修改 `src/data/site.json` 与 `public/sitemap.xml` 后重新构建。

## 上线前的表单配置

`/api/contact` 会校验请求，并通过 Wufoo API 提交询盘。部署时必须将 `.env.example` 中的 `WUFOO_API_KEY` 作为运行时密钥配置，不能提交到 GitHub。其余字段映射可按实际 Wufoo 表单调整；缺少密钥时接口会明确返回 `503`，不会伪装成提交成功，也不会把客户信息打印到日志。

正式上线前请用测试询盘验证 Wufoo 后台确实收到记录，并确认附件、邮箱通知和垃圾询盘策略均符合业务要求。

本地验证：使用 Node.js 22 或更新版本运行 `npm ci`、`npm run build`、`HOST=0.0.0.0 PORT=3000 npm run start`。
