const http = require('http');
const fs = require('fs');
const path = require('path');

const port = process.argv[2] || 38473;
const resDir = __dirname;

function resolvePath(p) {
  const s = (p || '').replace(/^~($|\/)/, (_, rest) => (process.env.HOME || '') + (rest || ''));
  return path.resolve(s);
}

function loadConfig() {
  const configPath = path.join(resDir, 'config.json');
  if (!fs.existsSync(configPath)) {
    return {
      skillRoots: [
        { id: 'global', label: '全局skill', path: '~/.cursor/skills' },
        { id: 'cursor', label: '应用内置skill', path: '~/.cursor/skills-cursor' },
        { id: 'clawdbot', label: '应用内置skill', path: '~/.clawdbot' },
        { id: 'antigravity', label: '应用内置skill', path: '~/.antigravity' },
        { id: 'claude', label: '应用内置skill', path: '~/.claude' }
      ],
      customRoots: [],
      projectScanPaths: []
    };
  }
  const raw = fs.readFileSync(configPath, 'utf8');
  const config = JSON.parse(raw);
  const roots = [...(config.skillRoots || []), ...(config.customRoots || [])];
  const projectNamePatterns = config.projectNamePatterns || [
    { id: 'cursor', pattern: '/([^/]+)/\\.cursor/skills', description: '.cursor 前的目录（如 moi）' },
    { id: 'skills', pattern: '/([^/]+)/skills/', description: 'skills 前的目录（如 clawdbot-main）' },
    { id: 'extensions', pattern: '/([^/]+)/extensions/', description: 'extensions 前的目录（如 clawdbot-main）' }
  ];
  return { ...config, allRoots: roots, projectNamePatterns };
}

function extractProjectName(pathOrSkillMd, fallback) {
  const config = loadConfig();
  const pathStr = path.normalize(pathOrSkillMd || '').replace(/\\/g, '/');
  for (const p of config.projectNamePatterns || []) {
    try {
      const re = new RegExp(p.pattern);
      const m = pathStr.match(re);
      if (m && m[1]) return m[1];
    } catch (_) {}
  }
  return fallback || '';
}

function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { name: '', description: '' };
  const yaml = match[1];
  const nameMatch = yaml.match(/^name:\s*(.+)$/m);
  const descMatch = yaml.match(/^description:\s*([^\n|]+|(?:\|[^\n]*\n(?:  [^\n]*\n)*))/m);
  let description = (descMatch && descMatch[1]) ? descMatch[1].trim() : '';
  if (description.startsWith('|')) {
    description = description.split('\n').map(l => l.replace(/^\s+/, '')).join(' ').trim();
  }
  return {
    name: (nameMatch && nameMatch[1]) ? nameMatch[1].trim() : '',
    description: description
  };
}

const SKIP_DIRS = new Set(['node_modules', '.git', '__pycache__', '.venv', 'venv', 'dist', 'build', 'out']);

function scanSkillDir(dirPath) {
  const skills = [];
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) return skills;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const skillPath = path.join(dirPath, ent.name);
    const skillMd = path.join(skillPath, 'SKILL.md');
    if (!fs.existsSync(skillMd)) continue;
    try {
      const content = fs.readFileSync(skillMd, 'utf8');
      const { name, description } = parseFrontmatter(content);
      const stat = fs.statSync(skillMd);
      let hasChildren = false;
      try {
        hasChildren = fs.readdirSync(skillPath, { withFileTypes: true }).length > 0;
      } catch (_) {}
      skills.push({
        name: name || ent.name,
        description: description || '',
        dirName: ent.name,
        path: skillPath,
        skillMd,
        createdAt: stat.birthtime.getTime(),
        updatedAt: stat.mtime.getTime(),
        hasChildren
      });
    } catch (_) {
      let hasChildren = false;
      try {
        hasChildren = fs.readdirSync(skillPath, { withFileTypes: true }).length > 0;
      } catch (_) {}
      skills.push({
        name: ent.name,
        description: '(无法解析)',
        dirName: ent.name,
        path: skillPath,
        skillMd,
        createdAt: 0,
        updatedAt: 0,
        hasChildren
      });
    }
  }
  return skills.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

function scanSkillsDirExtended(dirPath) {
  const skills = [];
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) return skills;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  for (const ent of entries) {
    const fullPath = path.join(dirPath, ent.name);
    if (ent.isDirectory()) {
      const skillMd = path.join(fullPath, 'SKILL.md');
      if (!fs.existsSync(skillMd)) continue;
      try {
        const content = fs.readFileSync(skillMd, 'utf8');
        const { name, description } = parseFrontmatter(content);
        const stat = fs.statSync(skillMd);
        let hasChildren = false;
        try { hasChildren = fs.readdirSync(fullPath, { withFileTypes: true }).length > 0; } catch (_) {}
        skills.push({
          name: name || ent.name,
          description: description || '',
          dirName: ent.name,
          path: fullPath,
          skillMd,
          createdAt: stat.birthtime.getTime(),
          updatedAt: stat.mtime.getTime(),
          hasChildren
        });
      } catch (_) {
        skills.push({ name: ent.name, description: '(无法解析)', dirName: ent.name, path: fullPath, skillMd: path.join(fullPath, 'SKILL.md'), createdAt: 0, updatedAt: 0, hasChildren: true });
      }
    } else if (ent.name.toLowerCase().endsWith('.md')) {
      const nameBase = path.basename(ent.name, '.md');
      try {
        const content = fs.readFileSync(fullPath, 'utf8');
        const { name, description } = parseFrontmatter(content);
        const stat = fs.statSync(fullPath);
        skills.push({
          name: name || nameBase,
          description: description || '',
          dirName: nameBase,
          path: path.dirname(fullPath),
          skillMd: fullPath,
          createdAt: stat.birthtime.getTime(),
          updatedAt: stat.mtime.getTime(),
          hasChildren: false
        });
      } catch (_) {
        skills.push({ name: nameBase, description: '(无法解析)', dirName: nameBase, path: path.dirname(fullPath), skillMd: fullPath, createdAt: 0, updatedAt: 0, hasChildren: false });
      }
    }
  }
  return skills.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
}

function findDirsOrFiles(rootPath, opts) {
  const { dirNames = [], fileNames = [], maxDepth = 8 } = opts;
  const results = { dirs: [], files: [] };
  const root = path.resolve(resolvePath(rootPath));
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return results;
  function walk(dir, depth) {
    if (depth > maxDepth) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name)) continue;
        const nameLower = ent.name.toLowerCase();
        if (dirNames.some(n => n.toLowerCase() === nameLower)) results.dirs.push(full);
        walk(full, depth + 1);
      } else if (fileNames.length && ent.name.toLowerCase().endsWith('.md')) {
        const base = path.basename(ent.name, '.md').toLowerCase();
        if (fileNames.some(n => n.toLowerCase() === base)) results.files.push(full);
      }
    }
  }
  walk(root, 0);
  return results;
}

function getProjectsUnderPath(rootPath) {
  const resolved = path.resolve(resolvePath(rootPath));
  const projectMap = new Map();
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) return [];

  function addToProject(projPath, projName, skillsList) {
    const key = projPath;
    if (!projectMap.has(key)) projectMap.set(key, { name: projName, path: projPath, skills: [] });
    const proj = projectMap.get(key);
    const seen = new Set(proj.skills.map(s => s.skillMd));
    for (const s of skillsList) {
      if (!seen.has(s.skillMd)) { seen.add(s.skillMd); proj.skills.push(s); }
    }
  }

  function mkSkillFromMd(mdPath) {
    const dir = path.dirname(mdPath);
    const nameBase = path.basename(mdPath, '.md');
    try {
      const content = fs.readFileSync(mdPath, 'utf8');
      const { name, description } = parseFrontmatter(content);
      const stat = fs.statSync(mdPath);
      return { name: name || nameBase, description: description || '', dirName: nameBase, path: dir, skillMd: mdPath, createdAt: stat.birthtime.getTime(), updatedAt: stat.mtime.getTime(), hasChildren: false };
    } catch (_) {
      return { name: nameBase, description: '(无法解析)', dirName: nameBase, path: dir, skillMd: mdPath, createdAt: 0, updatedAt: 0, hasChildren: false };
    }
  }

  const cursorSkills = path.join(resolved, '.cursor', 'skills');
  if (fs.existsSync(cursorSkills) && fs.statSync(cursorSkills).isDirectory()) {
    const skills = scanSkillDir(cursorSkills);
    if (skills.length) addToProject(resolved, path.basename(resolved), skills);
  }
  const entries = fs.readdirSync(resolved, { withFileTypes: true });
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const childPath = path.join(resolved, ent.name);
    const childSkillsDir = path.join(childPath, '.cursor', 'skills');
    if (fs.existsSync(childSkillsDir) && fs.statSync(childSkillsDir).isDirectory()) {
      const skills = scanSkillDir(childSkillsDir);
      if (skills.length) addToProject(childPath, ent.name, skills);
      continue;
    }
    try {
      const grandEntries = fs.readdirSync(childPath, { withFileTypes: true });
      for (const ge of grandEntries) {
        if (!ge.isDirectory()) continue;
        const grandPath = path.join(childPath, ge.name);
        const grandSkillsDir = path.join(grandPath, '.cursor', 'skills');
        if (fs.existsSync(grandSkillsDir) && fs.statSync(grandSkillsDir).isDirectory()) {
          const skills = scanSkillDir(grandSkillsDir);
          if (skills.length) addToProject(grandPath, ge.name, skills);
        }
      }
    } catch (_) {}
  }

  const { dirs: skillsDirs, files: skillMdFiles } = findDirsOrFiles(resolved, { dirNames: ['skills', 'skill'], fileNames: ['skill'], maxDepth: 8 });
  for (const d of skillsDirs) {
    const parent = path.dirname(d);
    const projName = path.basename(parent);
    const skills = scanSkillsDirExtended(d);
    if (skills.length) addToProject(parent, projName, skills);
  }
  for (const f of skillMdFiles) {
    const base = path.basename(f, '.md').toLowerCase();
    if (base !== 'skill') continue;
    const parent = path.dirname(f);
    const projName = path.basename(parent);
    addToProject(parent, projName, [mkSkillFromMd(f)]);
  }

  return Array.from(projectMap.values()).map(p => ({ ...p, skills: p.skills.sort((a, b) => (a.name || '').localeCompare(b.name || '')) }));
}

function getProjectPathsDetail(projectScanPaths) {
  const detail = [];
  for (const raw of projectScanPaths || []) {
    const p = (raw || '').trim();
    if (!p) continue;
    try {
      const projects = getProjectsUnderPath(p);
      let skillCount = 0;
      const projectsWithNames = projects.map(proj => ({
        ...proj,
        skills: proj.skills.map(s => {
          const projectName = extractProjectName(s.path || s.skillMd, proj.name);
          return { ...s, projectName: projectName || proj.name, projectPath: proj.path };
        })
      }));
      for (const proj of projectsWithNames) skillCount += proj.skills.length;
      detail.push({ path: p, skillCount, projects: projectsWithNames });
    } catch (_) {
      detail.push({ path: p, skillCount: 0, projects: [] });
    }
  }
  return detail;
}

function getProjectSkills(projectScanPaths) {
  const flatSkills = [];
  const seenPaths = new Set();
  for (const raw of projectScanPaths || []) {
    const p = (raw || '').trim();
    if (!p) continue;
    try {
      const projects = getProjectsUnderPath(p);
      for (const proj of projects) {
        const key = proj.path;
        if (seenPaths.has(key)) continue;
        seenPaths.add(key);
        for (const s of proj.skills) {
          const projectName = extractProjectName(s.path || s.skillMd, proj.name);
          flatSkills.push({ ...s, projectName: projectName || proj.name, projectPath: proj.path });
        }
      }
    } catch (_) { /* skip invalid path */ }
  }
  return flatSkills.sort((a, b) => (a.projectName || '').localeCompare(b.projectName || '') || (a.name || '').localeCompare(b.name || ''));
}

function getAllowedProjectSkillRoots() {
  const config = loadConfig();
  const roots = [];
  const projectScanRoots = [];
  for (const raw of config.projectScanPaths || []) {
    const p = (raw || '').trim();
    if (!p) continue;
    projectScanRoots.push(path.resolve(resolvePath(p)));
    try {
      const projects = getProjectsUnderPath(p);
      for (const proj of projects) {
        for (const s of proj.skills || []) {
          const skillDir = path.dirname(s.skillMd);
          if (!roots.includes(skillDir)) roots.push(skillDir);
        }
      }
      const { dirs } = findDirsOrFiles(p, { dirNames: ['skills', 'skill'], maxDepth: 8 });
      for (const d of dirs) {
        if (!roots.includes(d)) roots.push(d);
      }
    } catch (_) {}
  }
  return { roots, projectScanRoots };
}

function isPathUnderAllowedProjectRoots(filePath) {
  const resolved = path.resolve(filePath);
  const { projectScanRoots } = getAllowedProjectSkillRoots();
  for (const root of projectScanRoots) {
    if (resolved.startsWith(root + path.sep)) {
      const rel = resolved.slice(root.length);
      if (rel.includes(path.sep + 'node_modules' + path.sep) || rel.includes(path.sep + '.git' + path.sep)) return false;
      return true;
    }
  }
  return false;
}

function getAllSkills() {
  const config = loadConfig();
  const categoryMap = new Map();
  for (const root of config.allRoots || []) {
    const resolvedPath = resolvePath(root.path);
    const skills = scanSkillDir(resolvedPath);
    const label = root.label || root.id;
    if (!categoryMap.has(label)) {
      categoryMap.set(label, { id: root.id, label, paths: [], skills: [] });
    }
    const cat = categoryMap.get(label);
    cat.paths.push(resolvedPath);
    const appName = root.id;
    cat.skills.push(...skills.map(s => ({ ...s, appName })));
  }
  const categories = Array.from(categoryMap.values()).map(c => ({
    id: c.id,
    label: c.label,
    path: c.paths.join(', '),
    skills: c.skills.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
  }));
  const projectSkills = getProjectSkills(config.projectScanPaths);
  categories.push({
    id: 'projects',
    label: '项目skill',
    path: '',
    skills: projectSkills
  });
  return categories;
}

function getSkillContent(skillPath) {
  const decoded = decodeURIComponent(skillPath);
  const resolved = path.resolve(decoded);
  if (!fs.existsSync(resolved)) return null;
  if (!resolved.toLowerCase().endsWith('.md')) return null;
  if (!isAllowedSkillPath(resolved)) return null;
  return fs.readFileSync(resolved, 'utf8');
}

function isAllowedSkillDir(dirPath) {
  const decoded = decodeURIComponent(dirPath);
  const resolved = path.resolve(decoded);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) return false;
  const config = loadConfig();
  for (const root of config.allRoots || []) {
    const rootResolved = path.resolve(resolvePath(root.path));
    if (resolved.startsWith(rootResolved + path.sep)) return true;
  }
  const { roots, projectScanRoots } = getAllowedProjectSkillRoots();
  for (const skillRoot of roots) {
    const rootResolved = path.resolve(skillRoot);
    if (resolved.startsWith(rootResolved + path.sep)) return true;
  }
  if (isPathUnderAllowedProjectRoots(resolved)) return true;
  return false;
}

function getSkillChildren(skillDirPath) {
  if (!isAllowedSkillDir(skillDirPath)) return null;
  const resolved = path.resolve(decodeURIComponent(skillDirPath));
  const entries = fs.readdirSync(resolved, { withFileTypes: true });
  const children = [];
  for (const ent of entries) {
    const childPath = path.join(resolved, ent.name);
    const isDir = ent.isDirectory();
    let isSkill = false;
    if (isDir) isSkill = fs.existsSync(path.join(childPath, 'SKILL.md'));
    children.push({
      name: ent.name,
      path: childPath,
      type: isDir ? 'dir' : 'file',
      isSkill
    });
  }
  return children.sort((a, b) => a.name.localeCompare(b.name));
}

function isAllowedSkillPath(filePath) {
  const resolved = path.resolve(filePath);
  if (!resolved.toLowerCase().endsWith('.md')) return false;
  const config = loadConfig();
  for (const root of config.allRoots || []) {
    const rootResolved = path.resolve(resolvePath(root.path));
    if (resolved.startsWith(rootResolved + path.sep)) return true;
  }
  const { roots, projectScanRoots } = getAllowedProjectSkillRoots();
  for (const skillRoot of roots) {
    const rootResolved = path.resolve(skillRoot);
    if (resolved.startsWith(rootResolved + path.sep)) return true;
  }
  if (isPathUnderAllowedProjectRoots(resolved)) return true;
  return false;
}

function saveSkillContent(skillPath, content) {
  const decoded = decodeURIComponent(skillPath);
  const resolved = path.resolve(decoded);
  if (!isAllowedSkillPath(resolved)) return { ok: false, error: 'path not allowed' };
  fs.writeFileSync(resolved, content, 'utf8');
  return { ok: true };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '', 'http://127.0.0.1');
  const pathname = url.pathname;

  if (pathname === '/' || pathname === '/index.html') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(fs.readFileSync(path.join(resDir, 'index.html'), 'utf8'));
    return;
  }

  if (pathname === '/favicon.png' && req.method === 'GET') {
    const faviconPath = path.join(resDir, 'favicon.png');
    if (fs.existsSync(faviconPath)) {
      res.setHeader('Content-Type', 'image/png');
      res.end(fs.readFileSync(faviconPath));
    } else {
      res.statusCode = 404;
      res.end();
    }
    return;
  }

  if (pathname === '/api/skills' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    try {
      const config = loadConfig();
      res.end(JSON.stringify({
        categories: getAllSkills(),
        projectScanPaths: config.projectScanPaths || [],
        projectPathsDetail: getProjectPathsDetail(config.projectScanPaths || []),
        projectNamePatterns: config.projectNamePatterns || []
      }));
    } catch (e) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: String(e.message) }));
    }
    return;
  }

  if (pathname === '/api/config/project-paths' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    try {
      const config = loadConfig();
      res.end(JSON.stringify({ projectScanPaths: config.projectScanPaths || [] }));
    } catch (e) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: String(e.message) }));
    }
    return;
  }

  if (pathname === '/api/config/project-paths' && req.method === 'POST') {
    let body;
    try {
      body = await readBody(req);
      const { path: addPath } = JSON.parse(body);
      const p = (addPath != null ? String(addPath) : '').trim();
      if (!p) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: 'missing path' }));
        return;
      }
      const configPath = path.join(resDir, 'config.json');
      let config = {};
      if (fs.existsSync(configPath)) {
        config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      }
      const list = config.projectScanPaths || [];
      if (list.includes(p)) {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ projectScanPaths: list }));
        return;
      }
      config.projectScanPaths = [...list, p];
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ projectScanPaths: config.projectScanPaths }));
    } catch (e) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: String(e.message) }));
    }
    return;
  }

  if (pathname === '/api/config/project-paths' && req.method === 'DELETE') {
    const removePath = url.searchParams.get('path');
    const p = (removePath != null ? decodeURIComponent(removePath) : '').trim();
    if (!p) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'missing path' }));
      return;
    }
    try {
      const configPath = path.join(resDir, 'config.json');
      let config = {};
      if (fs.existsSync(configPath)) {
        config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      }
      const list = (config.projectScanPaths || []).filter(x => x !== p);
      config.projectScanPaths = list;
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ projectScanPaths: config.projectScanPaths }));
    } catch (e) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: String(e.message) }));
    }
    return;
  }

  if (pathname === '/api/config/project-name-patterns' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    try {
      const config = loadConfig();
      res.end(JSON.stringify({ projectNamePatterns: config.projectNamePatterns || [] }));
    } catch (e) {
      res.statusCode = 500;
      res.end(JSON.stringify({ error: String(e.message) }));
    }
    return;
  }

  if (pathname === '/api/config/project-name-patterns' && req.method === 'POST') {
    let body;
    try {
      body = await readBody(req);
      const { pattern, description } = JSON.parse(body);
      const pat = (pattern != null ? String(pattern) : '').trim();
      if (!pat) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ error: 'missing pattern' }));
        return;
      }
      const configPath = path.join(resDir, 'config.json');
      let config = {};
      if (fs.existsSync(configPath)) {
        config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      }
      const list = config.projectNamePatterns || [];
      const id = 'p' + Date.now();
      list.push({ id, pattern: pat, description: description != null ? String(description).trim() : '' });
      config.projectNamePatterns = list;
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ projectNamePatterns: config.projectNamePatterns }));
    } catch (e) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: String(e.message) }));
    }
    return;
  }

  if (pathname === '/api/config/project-name-patterns' && req.method === 'PUT') {
    let body;
    try {
      body = await readBody(req);
      const { patterns } = JSON.parse(body);
      const list = Array.isArray(patterns) ? patterns : [];
      const configPath = path.join(resDir, 'config.json');
      let config = {};
      if (fs.existsSync(configPath)) {
        config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      }
      config.projectNamePatterns = list.map((p, i) => ({
        id: p.id || ('p' + i),
        pattern: String(p.pattern || '').trim(),
        description: String(p.description || '').trim()
      })).filter(p => p.pattern);
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ projectNamePatterns: config.projectNamePatterns }));
    } catch (e) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: String(e.message) }));
    }
    return;
  }

  if (pathname === '/api/config/project-name-patterns' && req.method === 'DELETE') {
    const id = url.searchParams.get('id');
    if (!id) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'missing id' }));
      return;
    }
    try {
      const configPath = path.join(resDir, 'config.json');
      let config = {};
      if (fs.existsSync(configPath)) {
        config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      }
      const list = (config.projectNamePatterns || []).filter(p => p.id !== id);
      config.projectNamePatterns = list;
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ projectNamePatterns: config.projectNamePatterns }));
    } catch (e) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: String(e.message) }));
    }
    return;
  }

  if (pathname === '/api/skill' && req.method === 'GET') {
    const skillPath = url.searchParams.get('path');
    if (!skillPath) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'missing path' }));
      return;
    }
    const content = getSkillContent(skillPath);
    if (content === null) {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'not found or not allowed' }));
      return;
    }
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end(content);
    return;
  }

  if (pathname === '/api/skill/children' && req.method === 'GET') {
    const dirPath = url.searchParams.get('path');
    if (!dirPath) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'missing path' }));
      return;
    }
    const children = getSkillChildren(dirPath);
    if (children === null) {
      res.statusCode = 403;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: 'path not allowed' }));
      return;
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ children }));
    return;
  }

  if (pathname === '/api/skill' && req.method === 'POST') {
    let body;
    try {
      body = await readBody(req);
      const { path: skillPath, content } = JSON.parse(body);
      if (skillPath == null || content == null) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'missing path or content' }));
        return;
      }
      const result = saveSkillContent(skillPath, content);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      if (!result.ok) {
        res.statusCode = 403;
        res.end(JSON.stringify({ error: result.error }));
        return;
      }
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ error: String(e.message) }));
    }
    return;
  }

  res.statusCode = 404;
  res.end();
});

server.listen(port, '127.0.0.1', () => {
  console.log('Skill 管理器: http://127.0.0.1:' + port);
});
