# Skill 管理器

在 Mac 上集中查看与管理本机所有 Skill。双击打开，浏览器中按分类浏览、搜索、编辑，一键复制路径。

---

## 适合谁用

如果你在使用 Cursor、Clawdbot、OpenClaw 等工具的 Skill，但分散在不同目录，难以查找和编辑，Skill 管理器可以帮你：

- 把所有 Skill 汇总到一个页面
- 按「全局」「应用内置」「项目」分类查看
- 搜索、编辑、保存，并快速复制路径

不依赖大型桌面框架，占用内存小，启动快，用起来轻便。

---

## 依赖

本应用仅需本机已安装 **Node.js**（建议 18 或以上 LTS）。终端执行 `node -v` 可检查是否已安装及版本。

---

## 快速开始

1. 确保已满足上述依赖（本机已安装 Node.js）
2. 双击 `Skill管理器.app`（或右键 → 打开）
3. 浏览器会自动打开，进入管理界面

首次若提示无法打开，可在终端执行：

```bash
chmod +x Skill管理器.app/Contents/MacOS/launcher
```

---

## 主要功能

| 功能 | 说明 |
| --- | --- |
| 按分类查看 | 全局 skill、应用内置 skill、项目 skill 分 Tab 展示 |
| 搜索 | 按名称或描述过滤 |
| 编辑与保存 | 点击 Skill 或其中的 `.md` 文件，右侧查看编辑并保存 |
| 复制路径 | 一键复制 Skill 或子文件路径 |
| 项目管理 | 在「项目 skill」Tab 中添加扫描目录，自动发现 skill；可配置项目名识别正则 |
| 主题切换 | 右上角切换白色 / 黑色主题 |

---

## 分类说明

- **全局 skill**：`~/.cursor/skills` 下的 Skill，对所有 Cursor 项目生效
- **应用内置 skill**：各应用自带的 Skill（如 Cursor 内置、Clawdbot、OpenClaw 等）
- **项目 skill**：本地项目中的 Skill，需在「已添加的扫描目录」中配置父目录或具体项目路径

**项目 skill 的扫描规则**：

1. **优先**：`.cursor/skills`（Cursor 项目结构），根路径及两层子目录
2. **其次**：递归查找所有名为 `skills` 或 `skill` 的文件夹，扫描其下子目录中的 `SKILL.md` 及同级 `.md` 文件
3. **再次**：递归查找所有名为 `SKILL.md` 或 `skill.md` 的独立文件

扫描时跳过 `node_modules`、`.git` 等无关目录。

---

## 配置

编辑 `Skill管理器.app/Contents/Resources/config.json`：

- **skillRoots**：定义全局和应用内置 Skill 的来源路径（支持 `~`）
- **projectScanPaths**：项目 Skill 的扫描根目录（可在界面上添加或删除）
- **projectNamePatterns**：项目名识别正则（可在「项目 skill」Tab 下管理），按顺序匹配路径，第一个捕获组为项目名

修改后重启应用生效。

---

## 开发时同步到应用程序

若已将 `Skill管理器.app` 拷贝到 `/Applications` 或 `~/Applications`，修改 `server.js`、`index.html`、`config.json` 后，可执行：

```bash
./Skill管理器.app/同步到应用.sh
```

将最新资源同步到应用程序中的副本。

---

# 技术实现

## 项目结构

```
skill管理器/
├── README.md
└── Skill管理器.app/
    ├── Contents/
    │   ├── Info.plist          # 应用元信息
    │   ├── MacOS/
    │   │   └── launcher        # 启动脚本：杀旧进程 → 起 Node 服务 → 打开浏览器
    │       └── Resources/
    │       ├── server.js       # HTTP 服务：静态文件 + REST API
    │       ├── index.html      # 单页前端（HTML/CSS/JS）
    │       ├── config.json     # 分类、路径与项目名正则配置
    │       ├── AppIcon.icns    # 应用图标
    │       └── favicon.png     # 网页标签图标
    └── 同步到应用.sh           # 开发时同步 Resources 到 /Applications 中的 .app
```

---

## 技术栈

| 层级 | 技术 |
| --- | --- |
| 运行环境 | Node.js（无 Electron） |
| 服务端 | Node 原生 `http` 模块 |
| 前端 | 纯 HTML + CSS + 原生 JavaScript |
| 配置 | JSON |

采用「mac-browser-app」模式：轻量、无打包、直接打开浏览器访问本地服务。

---

## API 设计

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/`、`/index.html` | 返回前端页面 |
| GET | `/favicon.png` | 返回网页标签图标 |
| GET | `/api/skills` | 返回所有分类、项目扫描路径、项目详情 |
| GET | `/api/skill?path=...` | 读取指定 `.md` 文件内容 |
| POST | `/api/skill` | 保存 `.md` 文件 |
| GET | `/api/skill/children?path=...` | 获取指定目录下的子文件/子目录 |
| GET | `/api/config/project-paths` | 获取项目扫描路径列表 |
| POST | `/api/config/project-paths` | 添加项目扫描路径 |
| DELETE | `/api/config/project-paths?path=...` | 删除项目扫描路径 |
| GET | `/api/config/project-name-patterns` | 获取项目名识别正则列表 |
| POST | `/api/config/project-name-patterns` | 添加项目名正则 |
| PUT | `/api/config/project-name-patterns` | 覆盖项目名正则列表 |
| DELETE | `/api/config/project-name-patterns?id=...` | 删除项目名正则 |

---

## 扫描与识别逻辑

### Skill 定义

- 必须位于 `xxx/skill子目录/SKILL.md`
- `scanSkillDir(dirPath)` 遍历 `dirPath` 下子目录，仅当存在 `SKILL.md` 时计入一个 Skill
- 从 YAML frontmatter 解析 `name`、`description`

### 项目 skill 扫描

`getProjectsUnderPath(rootPath)` 按优先级识别：

1. **Cursor 项目（优先）**：`.cursor/skills`，根路径及两层子目录
2. **skills/skill 目录**：递归查找 `skills` 或 `skill` 文件夹（最多 8 层），支持子目录中的 `SKILL.md` 及同级 `.md` 文件
3. **独立 SKILL.md**：递归查找名为 `SKILL.md` 或 `skill.md` 的文件

扫描时跳过 `node_modules`、`.git`、`__pycache__`、`.venv`、`dist`、`build`、`out`。`.cursor/skills` 由 Cursor 规则处理，不计入 `skills/` 扫描。

### 项目名识别

`extractProjectName(path)` 按 `projectNamePatterns` 顺序匹配路径，第一个捕获组为项目名；`.cursor` 作为项目名时视为无效，跳过该匹配。

### 路径校验

- `isAllowedSkillPath`：读写文件前校验路径是否在配置的 skill 根或项目根下
- `resolvePath`：支持 `~` 解析为用户主目录

---

## 端口与进程

- 固定端口：`38473`
- 启动时 `launcher` 会先结束占用该端口的旧进程，再启动新服务，确保每次打开都是最新代码
