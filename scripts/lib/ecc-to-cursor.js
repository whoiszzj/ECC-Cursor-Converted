const fs = require("fs");
const path = require("path");

const DEFAULT_REPO_URL = "https://github.com/affaan-m/everything-claude-code.git";
const DEFAULT_SOURCE_ROOT = path.resolve(process.cwd(), "src", "everything-claude-code");
const DEFAULT_DESTINATION_ROOT = path.resolve(process.cwd(), "dst");
const DEFAULT_CONFIG_PATH = path.resolve(process.cwd(), "config", "agent-models.json");
const DEFAULT_IGNORE_CONFIG_PATH = path.resolve(process.cwd(), "config", "convert-ignore.json");

const SOURCE_DIRECTORIES = {
  skills: "skills",
  agents: "agents",
  commands: "commands",
  rules: "rules",
};
const CURSOR_SOURCE_DIRECTORIES = {
  hooksRoot: ".cursor",
  hooksConfig: path.join(".cursor", "hooks.json"),
  hooksScripts: path.join(".cursor", "hooks"),
};

const LANGUAGE_GLOBS = {
  typescript: ["**/*.ts", "**/*.tsx", "**/*.js", "**/*.jsx"],
  javascript: ["**/*.js", "**/*.jsx"],
  python: ["**/*.py"],
  golang: ["**/*.go"],
  swift: ["**/*.swift"],
  php: ["**/*.php"],
  kotlin: ["**/*.kt", "**/*.kts"],
  java: ["**/*.java"],
  cpp: ["**/*.cpp", "**/*.cc", "**/*.cxx", "**/*.hpp", "**/*.hh", "**/*.h"],
  csharp: ["**/*.cs"],
  rust: ["**/*.rs"],
  perl: ["**/*.pl", "**/*.pm", "**/*.t"],
};

const SKILL_FRONTMATTER_FIELDS = [
  "name",
  "description",
  "license",
  "compatibility",
  "metadata",
  "disable-model-invocation",
];

const BODY_REPLACEMENTS = [
  {
    from: /~\/\.claude\/agents\b/g,
    to: "~/.cursor/agents",
  },
];

const DEFAULT_AGENT_MODEL_CONFIG = {
  categories: {
    planning: "claude-code-opus-4.6",
    default: "gpt-5.3-codx",
    doc: "gpt-5.4",
  },
  matches: {
    planning: ["planner", "architect"],
    doc: ["doc-updater", "docs-lookup"],
  },
  overrides: {},
};

const DEFAULT_IGNORE_CONFIG = {
  skills: [],
  agents: [],
  commands: [],
  rules: [],
};

function ensureDirectory(targetPath) {
  fs.mkdirSync(targetPath, { recursive: true });
}

function pathExists(targetPath) {
  return fs.existsSync(targetPath);
}

function emptyDirectory(targetPath) {
  fs.rmSync(targetPath, { recursive: true, force: true });
  ensureDirectory(targetPath);
}

function readText(targetPath) {
  return fs.readFileSync(targetPath, "utf8").replace(/\r\n/g, "\n");
}

function readJson(targetPath) {
  return JSON.parse(readText(targetPath));
}

function writeText(targetPath, content) {
  ensureDirectory(path.dirname(targetPath));
  fs.writeFileSync(targetPath, normalizeText(content));
}

function normalizeText(content) {
  return `${String(content).replace(/\r\n/g, "\n").replace(/\s+$/u, "")}\n`;
}

function toKebabCase(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function toTitleCase(value) {
  return String(value)
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map(segment => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function stripWrappingQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function coerceScalar(value) {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  if (trimmed === "true") {
    return true;
  }

  if (trimmed === "false") {
    return false;
  }

  if (trimmed === "null") {
    return null;
  }

  if (/^-?\d+$/u.test(trimmed)) {
    return Number(trimmed);
  }

  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return stripWrappingQuotes(trimmed);
    }
  }

  return stripWrappingQuotes(trimmed);
}

function parseFrontmatter(markdown) {
  const normalized = markdown.replace(/\r\n/g, "\n");

  if (!normalized.startsWith("---\n")) {
    return {
      attributes: {},
      body: normalized,
      hasFrontmatter: false,
    };
  }

  const closingIndex = normalized.indexOf("\n---\n", 4);
  if (closingIndex === -1) {
    return {
      attributes: {},
      body: normalized,
      hasFrontmatter: false,
    };
  }

  const rawFrontmatter = normalized.slice(4, closingIndex);
  const body = normalized.slice(closingIndex + 5);
  const lines = rawFrontmatter.split("\n");
  const attributes = {};

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) {
      continue;
    }

    const match = line.match(/^([A-Za-z0-9_-]+):(.*)$/u);
    if (!match) {
      continue;
    }

    const key = match[1];
    const inlineValue = match[2].trim();

    if (inlineValue) {
      attributes[key] = coerceScalar(inlineValue);
      continue;
    }

    const items = [];
    const nestedPairs = {};

    while (index + 1 < lines.length) {
      const nextLine = lines[index + 1];

      if (/^\s*-\s+/u.test(nextLine)) {
        items.push(coerceScalar(nextLine.replace(/^\s*-\s+/u, "").trim()));
        index += 1;
        continue;
      }

      const nestedMatch = nextLine.match(/^\s+([A-Za-z0-9_-]+):(.*)$/u);
      if (nestedMatch) {
        nestedPairs[nestedMatch[1]] = coerceScalar(nestedMatch[2].trim());
        index += 1;
        continue;
      }

      break;
    }

    if (items.length > 0) {
      attributes[key] = items;
    } else if (Object.keys(nestedPairs).length > 0) {
      attributes[key] = nestedPairs;
    } else {
      attributes[key] = "";
    }
  }

  return {
    attributes,
    body,
    hasFrontmatter: true,
  };
}

function serializeValue(value) {
  if (Array.isArray(value)) {
    return `[${value.map(item => JSON.stringify(String(item))).join(", ")}]`;
  }

  if (typeof value === "boolean" || typeof value === "number") {
    return String(value);
  }

  return JSON.stringify(String(value));
}

function renderFrontmatter(attributes) {
  const entries = Object.entries(attributes).filter(([, value]) => {
    if (value === undefined || value === null) {
      return false;
    }

    if (typeof value === "string" && value.trim() === "") {
      return false;
    }

    if (Array.isArray(value) && value.length === 0) {
      return false;
    }

    if (
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).length === 0
    ) {
      return false;
    }

    return true;
  });

  if (entries.length === 0) {
    return "";
  }

  const lines = ["---"];

  for (const [key, value] of entries) {
    if (typeof value === "object" && !Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const [nestedKey, nestedValue] of Object.entries(value)) {
        lines.push(`  ${nestedKey}: ${serializeValue(nestedValue)}`);
      }
      continue;
    }

    lines.push(`${key}: ${serializeValue(value)}`);
  }

  lines.push("---", "");
  return lines.join("\n");
}

function renderAgentFrontmatter(attributes) {
  const orderedAttributes = {};
  const rawName = String(attributes.name || "").trim();
  const normalizedName = rawName.replace(/^agent-/u, "");

  if (Array.isArray(attributes.tools) && attributes.tools.length > 0) {
    orderedAttributes.tools = attributes.tools;
  }

  orderedAttributes.name = `agent-${normalizedName}`;

  if (
    attributes.model !== undefined &&
    attributes.model !== null &&
    String(attributes.model).trim() !== ""
  ) {
    orderedAttributes.model = String(attributes.model).trim();
  }

  if (
    attributes.description !== undefined &&
    attributes.description !== null &&
    String(attributes.description).trim() !== ""
  ) {
    orderedAttributes.description = String(attributes.description).trim();
  }

  for (const [key, value] of Object.entries(attributes)) {
    if (key === "tools" || key === "name" || key === "model" || key === "description") {
      continue;
    }

    if (value === undefined || value === null) {
      continue;
    }

    if (typeof value === "string" && value.trim() === "") {
      continue;
    }

    if (Array.isArray(value) && value.length === 0) {
      continue;
    }

    if (
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).length === 0
    ) {
      continue;
    }

    orderedAttributes[key] = value;
  }

  const lines = ["---"];

  for (const [key, value] of Object.entries(orderedAttributes)) {
    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.map(item => JSON.stringify(String(item))).join(", ")}]`);
      continue;
    }

    if (typeof value === "boolean" || typeof value === "number") {
      lines.push(`${key}: ${String(value)}`);
      continue;
    }

    if (key === "name" || key === "model" || key === "description") {
      lines.push(`${key}: ${String(value)}`);
      continue;
    }

    if (typeof value === "object") {
      lines.push(`${key}:`);
      for (const [nestedKey, nestedValue] of Object.entries(value)) {
        lines.push(`  ${nestedKey}: ${serializeValue(nestedValue)}`);
      }
      continue;
    }

    lines.push(`${key}: ${serializeValue(value)}`);
  }

  lines.push("---", "");
  return lines.join("\n");
}

function firstHeading(body) {
  const match = body.match(/^#\s+(.+)$/mu);
  return match ? match[1].trim() : "";
}

function fallbackDescription(kind, slug, body) {
  const title = firstHeading(body) || toTitleCase(slug);

  switch (kind) {
    case "skill":
      return `${title}. Use when this workflow or domain expertise is needed.`;
    case "agent":
      return `${title} agent for specialized Cursor workflows.`;
    case "command":
      return `${title} command for Cursor agent execution.`;
    case "rule":
      return `${title} rule for Cursor agent guidance.`;
    default:
      return title;
  }
}

function trimBody(body) {
  return body.replace(/^\n+/u, "").replace(/\n+$/u, "");
}

function normalizeBodyContent(body) {
  let normalized = trimBody(body);

  for (const replacement of BODY_REPLACEMENTS) {
    normalized = normalized.replace(replacement.from, replacement.to);
  }

  return normalized;
}

function listDirectories(targetPath) {
  return fs.readdirSync(targetPath, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

function listFiles(targetPath, extensions) {
  return fs.readdirSync(targetPath, { withFileTypes: true })
    .filter(entry => entry.isFile() && extensions.includes(path.extname(entry.name).toLowerCase()))
    .map(entry => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

function copyDirectoryContents(sourceDir, targetDir, filter) {
  ensureDirectory(targetDir);

  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (filter && !filter(sourcePath, entry)) {
      continue;
    }

    if (entry.isDirectory()) {
      copyDirectoryContents(sourcePath, targetPath, filter);
      continue;
    }

    ensureDirectory(path.dirname(targetPath));
    fs.copyFileSync(sourcePath, targetPath);
  }
}

function copyDirectoryContentsWithTransform(sourceDir, targetDir, transformContent) {
  ensureDirectory(targetDir);

  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      copyDirectoryContentsWithTransform(sourcePath, targetPath, transformContent);
      continue;
    }

    const extension = path.extname(entry.name).toLowerCase();
    const textExtensions = new Set([
      ".js",
      ".mjs",
      ".cjs",
      ".ts",
      ".tsx",
      ".jsx",
      ".json",
      ".md",
      ".mdc",
      ".txt",
      ".sh",
      ".py",
      ".yaml",
      ".yml",
      ".toml",
      ".ini",
      ".cfg",
    ]);

    ensureDirectory(path.dirname(targetPath));

    if (textExtensions.has(extension)) {
      const raw = readText(sourcePath);
      const transformed = transformContent ? transformContent(raw, sourcePath) : raw;
      writeText(targetPath, transformed);
      continue;
    }

    fs.copyFileSync(sourcePath, targetPath);
  }
}

function removeFrontmatter(markdown) {
  return parseFrontmatter(markdown).body;
}

function locateSourceDirectories(sourceRoot = DEFAULT_SOURCE_ROOT) {
  const resolvedRoot = path.resolve(sourceRoot);
  const locations = Object.fromEntries(
    Object.entries(SOURCE_DIRECTORIES).map(([key, relativeDir]) => [
      key,
      path.join(resolvedRoot, relativeDir),
    ]),
  );

  const missing = Object.entries(locations)
    .filter(([, targetPath]) => !pathExists(targetPath))
    .map(([key]) => key);

  return {
    root: resolvedRoot,
    locations,
    missing,
    isComplete: missing.length === 0,
  };
}

function loadAgentModelConfig(configPath = DEFAULT_CONFIG_PATH) {
  const resolvedConfigPath = path.resolve(configPath);

  if (!pathExists(resolvedConfigPath)) {
    return {
      configPath: resolvedConfigPath,
      config: structuredClone(DEFAULT_AGENT_MODEL_CONFIG),
    };
  }

  const userConfig = readJson(resolvedConfigPath);

  return {
    configPath: resolvedConfigPath,
    config: {
      categories: {
        ...DEFAULT_AGENT_MODEL_CONFIG.categories,
        ...(userConfig.categories || {}),
      },
      matches: {
        ...DEFAULT_AGENT_MODEL_CONFIG.matches,
        ...(userConfig.matches || {}),
      },
      overrides: {
        ...DEFAULT_AGENT_MODEL_CONFIG.overrides,
        ...(userConfig.overrides || {}),
      },
    },
  };
}

function loadIgnoreConfig(configPath = DEFAULT_IGNORE_CONFIG_PATH) {
  const resolvedConfigPath = path.resolve(configPath);

  if (!pathExists(resolvedConfigPath)) {
    return {
      configPath: resolvedConfigPath,
      config: structuredClone(DEFAULT_IGNORE_CONFIG),
    };
  }

  const userConfig = readJson(resolvedConfigPath);

  return {
    configPath: resolvedConfigPath,
    config: {
      skills: Array.isArray(userConfig.skills) ? userConfig.skills : [],
      agents: Array.isArray(userConfig.agents) ? userConfig.agents : [],
      commands: Array.isArray(userConfig.commands) ? userConfig.commands : [],
      rules: Array.isArray(userConfig.rules) ? userConfig.rules : [],
    },
  };
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function asMatcher(pattern) {
  const value = String(pattern || "").trim();

  if (!value) {
    return null;
  }

  if (value.startsWith("/") && value.endsWith("/") && value.length > 2) {
    return new RegExp(value.slice(1, -1), "u");
  }

  const globRegex = `^${escapeRegex(value).replace(/\\\*/g, ".*").replace(/\\\?/g, ".")}$`;
  return new RegExp(globRegex, "u");
}

function isIgnored(kind, name, ignoreConfig) {
  const patterns = Array.isArray(ignoreConfig?.[kind]) ? ignoreConfig[kind] : [];

  for (const pattern of patterns) {
    const matcher = asMatcher(pattern);
    if (matcher && matcher.test(name)) {
      return true;
    }
  }

  return false;
}

function resolveAgentCategory(agentName, agentModelConfig) {
  const overrides = agentModelConfig.overrides || {};
  if (typeof overrides[agentName] === "string" && overrides[agentName].trim()) {
    return overrides[agentName].trim();
  }

  const matches = agentModelConfig.matches || {};
  for (const [category, names] of Object.entries(matches)) {
    if (Array.isArray(names) && names.includes(agentName)) {
      return category;
    }
  }

  return "default";
}

function resolveAgentModel(agentName, agentModelConfig, sourceModel) {
  const category = resolveAgentCategory(agentName, agentModelConfig);
  const categories = agentModelConfig.categories || {};
  const configuredModel = categories[category];

  return {
    category,
    model: configuredModel || sourceModel,
  };
}

function convertSkills({
  sourceRoot = DEFAULT_SOURCE_ROOT,
  destinationRoot = DEFAULT_DESTINATION_ROOT,
  ignoreConfigPath = DEFAULT_IGNORE_CONFIG_PATH,
  clean = false,
} = {}) {
  const sourceDir = path.join(path.resolve(sourceRoot), SOURCE_DIRECTORIES.skills);
  const targetDir = path.join(path.resolve(destinationRoot), "skills");
  const { config: ignoreConfig } = loadIgnoreConfig(ignoreConfigPath);

  if (!pathExists(sourceDir)) {
    throw new Error(`Skills source directory not found: ${sourceDir}`);
  }

  if (clean) {
    emptyDirectory(targetDir);
  } else {
    ensureDirectory(targetDir);
  }

  const converted = [];

  for (const directoryName of listDirectories(sourceDir)) {
    const sourceSkillDir = path.join(sourceDir, directoryName);
    const sourceSkillFile = path.join(sourceSkillDir, "SKILL.md");

    if (!pathExists(sourceSkillFile)) {
      continue;
    }

    const slug = toKebabCase(directoryName);
    if (isIgnored("skills", slug, ignoreConfig)) {
      continue;
    }
    const targetSkillDir = path.join(targetDir, slug);
    const targetSkillFile = path.join(targetSkillDir, "SKILL.md");
    const { attributes, body } = parseFrontmatter(readText(sourceSkillFile));
    const outputAttributes = {};

    for (const field of SKILL_FRONTMATTER_FIELDS) {
      if (attributes[field] !== undefined) {
        outputAttributes[field] = attributes[field];
      }
    }

    outputAttributes.name = slug;
    outputAttributes.description =
      attributes.description ||
      fallbackDescription("skill", slug, body);

    copyDirectoryContents(sourceSkillDir, targetSkillDir, sourcePath => {
      return path.basename(sourcePath) !== "SKILL.md";
    });

    writeText(
      targetSkillFile,
      `${renderFrontmatter(outputAttributes)}${normalizeBodyContent(body)}\n`,
    );

    converted.push({
      source: sourceSkillFile,
      output: targetSkillFile,
      name: slug,
    });
  }

  return converted;
}

function convertAgents({
  sourceRoot = DEFAULT_SOURCE_ROOT,
  destinationRoot = DEFAULT_DESTINATION_ROOT,
  configPath = DEFAULT_CONFIG_PATH,
  ignoreConfigPath = DEFAULT_IGNORE_CONFIG_PATH,
  clean = false,
} = {}) {
  const sourceDir = path.join(path.resolve(sourceRoot), SOURCE_DIRECTORIES.agents);
  const targetDir = path.join(path.resolve(destinationRoot), "agents");
  const { config: agentModelConfig } = loadAgentModelConfig(configPath);
  const { config: ignoreConfig } = loadIgnoreConfig(ignoreConfigPath);

  if (!pathExists(sourceDir)) {
    throw new Error(`Agents source directory not found: ${sourceDir}`);
  }

  if (clean) {
    emptyDirectory(targetDir);
  } else {
    ensureDirectory(targetDir);
  }

  const converted = [];

  for (const fileName of listFiles(sourceDir, [".md", ".mdc", ".markdown"])) {
    const sourcePath = path.join(sourceDir, fileName);
    const slug = toKebabCase(path.basename(fileName, path.extname(fileName)));
    if (isIgnored("agents", slug, ignoreConfig)) {
      continue;
    }
    const targetPath = path.join(targetDir, `${slug}.md`);
    const { attributes, body } = parseFrontmatter(readText(sourcePath));
    const modelResolution = resolveAgentModel(slug, agentModelConfig, attributes.model);
    const outputAttributes = {
      ...attributes,
      name: slug,
      description: attributes.description || fallbackDescription("agent", slug, body),
      model: modelResolution.model,
    };

    writeText(
      targetPath,
      `${renderAgentFrontmatter(outputAttributes)}${normalizeBodyContent(body)}\n`,
    );

    converted.push({
      source: sourcePath,
      output: targetPath,
      name: slug,
      category: modelResolution.category,
      model: modelResolution.model,
    });
  }

  return converted;
}

function convertCommands({
  sourceRoot = DEFAULT_SOURCE_ROOT,
  destinationRoot = DEFAULT_DESTINATION_ROOT,
  ignoreConfigPath = DEFAULT_IGNORE_CONFIG_PATH,
  clean = false,
} = {}) {
  const sourceDir = path.join(path.resolve(sourceRoot), SOURCE_DIRECTORIES.commands);
  const targetDir = path.join(path.resolve(destinationRoot), "commands");
  const { config: ignoreConfig } = loadIgnoreConfig(ignoreConfigPath);

  if (!pathExists(sourceDir)) {
    throw new Error(`Commands source directory not found: ${sourceDir}`);
  }

  if (clean) {
    emptyDirectory(targetDir);
  } else {
    ensureDirectory(targetDir);
  }

  const converted = [];

  for (const fileName of listFiles(sourceDir, [".md", ".mdc", ".markdown", ".txt"])) {
    const sourcePath = path.join(sourceDir, fileName);
    const slug = toKebabCase(path.basename(fileName, path.extname(fileName)));
    if (isIgnored("commands", slug, ignoreConfig)) {
      continue;
    }
    const targetPath = path.join(targetDir, `${slug}.md`);
    const { attributes, body } = parseFrontmatter(readText(sourcePath));

    writeText(
      targetPath,
      `${renderFrontmatter({
        name: slug,
        description: attributes.description || fallbackDescription("command", slug, body),
      })}${normalizeBodyContent(body)}\n`,
    );

    converted.push({
      source: sourcePath,
      output: targetPath,
      name: slug,
    });
  }

  return converted;
}

function buildRuleAttributes(group, fileSlug, sourceAttributes, body) {
  const attributes = {
    description:
      fallbackDescription("rule", `${group}-${fileSlug}`, body),
  };

  if (group === "common") {
    attributes.alwaysApply = true;
    return attributes;
  }

  attributes.alwaysApply = false;

  if (Array.isArray(sourceAttributes.paths) && sourceAttributes.paths.length > 0) {
    attributes.globs = sourceAttributes.paths;
    return attributes;
  }

  if (Array.isArray(sourceAttributes.globs) && sourceAttributes.globs.length > 0) {
    attributes.globs = sourceAttributes.globs;
    return attributes;
  }

  if (LANGUAGE_GLOBS[group]) {
    attributes.globs = LANGUAGE_GLOBS[group];
  }

  return attributes;
}

function convertRules({
  sourceRoot = DEFAULT_SOURCE_ROOT,
  destinationRoot = DEFAULT_DESTINATION_ROOT,
  ignoreConfigPath = DEFAULT_IGNORE_CONFIG_PATH,
  clean = false,
} = {}) {
  const sourceDir = path.join(path.resolve(sourceRoot), SOURCE_DIRECTORIES.rules);
  const targetDir = path.join(path.resolve(destinationRoot), "rules");
  const { config: ignoreConfig } = loadIgnoreConfig(ignoreConfigPath);

  if (!pathExists(sourceDir)) {
    throw new Error(`Rules source directory not found: ${sourceDir}`);
  }

  if (clean) {
    emptyDirectory(targetDir);
  } else {
    ensureDirectory(targetDir);
  }

  const converted = [];

  for (const group of listDirectories(sourceDir)) {
    const sourceGroupDir = path.join(sourceDir, group);
    const ruleFiles = listFiles(sourceGroupDir, [".md", ".mdc", ".markdown"]);

    for (const fileName of ruleFiles) {
      const sourcePath = path.join(sourceGroupDir, fileName);
      const fileSlug = toKebabCase(path.basename(fileName, path.extname(fileName)));
      const ruleName = `${group}-${fileSlug}`;
      if (isIgnored("rules", ruleName, ignoreConfig)) {
        continue;
      }
      const targetPath = path.join(targetDir, `${group}-${fileSlug}.mdc`);
      const { attributes, body } = parseFrontmatter(readText(sourcePath));
      const outputAttributes = buildRuleAttributes(group, fileSlug, attributes, body);

      writeText(
        targetPath,
        `${renderFrontmatter(outputAttributes)}${normalizeBodyContent(body)}\n`,
      );

      converted.push({
        source: sourcePath,
        output: targetPath,
        name: ruleName,
      });
    }
  }

  return converted;
}

function rewriteHookCommandPath(command) {
  if (typeof command !== "string") {
    return command;
  }

  return command.replace(/(^|[\s"'`])\.cursor\/hooks\//g, "$1hooks/");
}

function convertHooks({
  sourceRoot = DEFAULT_SOURCE_ROOT,
  destinationRoot = DEFAULT_DESTINATION_ROOT,
  clean = false,
} = {}) {
  const resolvedSourceRoot = path.resolve(sourceRoot);
  const sourceHooksConfigPath = path.join(resolvedSourceRoot, CURSOR_SOURCE_DIRECTORIES.hooksConfig);
  const sourceHooksScriptsDir = path.join(resolvedSourceRoot, CURSOR_SOURCE_DIRECTORIES.hooksScripts);
  const targetHooksDir = path.join(path.resolve(destinationRoot), "hooks");
  const targetHooksConfigPath = path.join(targetHooksDir, "hooks.json");

  if (!pathExists(sourceHooksConfigPath) || !pathExists(sourceHooksScriptsDir)) {
    return [];
  }

  if (clean) {
    emptyDirectory(targetHooksDir);
  } else {
    ensureDirectory(targetHooksDir);
  }

  copyDirectoryContentsWithTransform(sourceHooksScriptsDir, targetHooksDir, content => {
    return normalizeBodyContent(content);
  });

  const hooksConfig = readJson(sourceHooksConfigPath);
  const rewrittenHooksConfig = {
    ...hooksConfig,
    version: Number.isFinite(Number(hooksConfig.version))
      ? Number(hooksConfig.version)
      : 1,
    hooks: Object.fromEntries(
      Object.entries(hooksConfig.hooks || {}).map(([eventName, entries]) => [
        eventName,
        Array.isArray(entries)
          ? entries.map(entry => ({
            ...entry,
            command: rewriteHookCommandPath(entry.command),
          }))
          : entries,
      ]),
    ),
  };

  writeText(targetHooksConfigPath, JSON.stringify(rewrittenHooksConfig, null, 2));

  const outputs = [{
    source: sourceHooksConfigPath,
    output: targetHooksConfigPath,
    name: "hooks-config",
  }];

  for (const entry of fs.readdirSync(targetHooksDir, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }

    if (entry.name === "hooks.json") {
      continue;
    }

    outputs.push({
      source: path.join(sourceHooksScriptsDir, entry.name),
      output: path.join(targetHooksDir, entry.name),
      name: `hook-script-${entry.name}`,
    });
  }

  return outputs;
}

function writePluginManifest({
  destinationRoot = DEFAULT_DESTINATION_ROOT,
  skills = [],
  agents = [],
  commands = [],
  rules = [],
  hooks = [],
} = {}) {
  const targetRoot = path.resolve(destinationRoot);
  const manifestDir = path.join(targetRoot, ".cursor-plugin");
  const manifestPath = path.join(manifestDir, "plugin.json");
  const manifest = {
    name: "ecc-cursor-converted",
    version: "0.1.0",
    description:
      "Converted Cursor plugin assets generated from affaan-m/everything-claude-code.",
    repository: DEFAULT_REPO_URL,
    rules: "rules",
    skills: "skills",
    agents: "agents",
    commands: "commands",
  };

  if (hooks.length > 0) {
    manifest.hooks = "hooks/hooks.json";
  }

  writeText(manifestPath, JSON.stringify(manifest, null, 2));
  return manifestPath;
}

function writeConversionReport({
  destinationRoot = DEFAULT_DESTINATION_ROOT,
  sourceRoot = DEFAULT_SOURCE_ROOT,
  skills = [],
  agents = [],
  commands = [],
  rules = [],
  hooks = [],
} = {}) {
  const reportPath = path.join(path.resolve(destinationRoot), "conversion-report.json");
  const report = {
    sourceRoot: path.resolve(sourceRoot),
    destinationRoot: path.resolve(destinationRoot),
    counts: {
      skills: skills.length,
      agents: agents.length,
      commands: commands.length,
      rules: rules.length,
      hooks: hooks.length,
    },
    generatedAt: new Date().toISOString(),
    outputs: {
      skills: skills.map(item => path.relative(path.resolve(destinationRoot), item.output)),
      agents: agents.map(item => path.relative(path.resolve(destinationRoot), item.output)),
      commands: commands.map(item => path.relative(path.resolve(destinationRoot), item.output)),
      rules: rules.map(item => path.relative(path.resolve(destinationRoot), item.output)),
      hooks: hooks.map(item => path.relative(path.resolve(destinationRoot), item.output)),
    },
  };

  writeText(reportPath, JSON.stringify(report, null, 2));
  return reportPath;
}

function buildCursorPlugin({
  sourceRoot = DEFAULT_SOURCE_ROOT,
  destinationRoot = DEFAULT_DESTINATION_ROOT,
  configPath = DEFAULT_CONFIG_PATH,
  ignoreConfigPath = DEFAULT_IGNORE_CONFIG_PATH,
  cleanDestination = true,
} = {}) {
  const resolvedDestination = path.resolve(destinationRoot);

  if (cleanDestination) {
    emptyDirectory(resolvedDestination);
  } else {
    ensureDirectory(resolvedDestination);
  }

  const skills = convertSkills({
    sourceRoot,
    destinationRoot: resolvedDestination,
    ignoreConfigPath,
    clean: false,
  });
  const agents = convertAgents({
    sourceRoot,
    destinationRoot: resolvedDestination,
    configPath,
    ignoreConfigPath,
    clean: false,
  });
  const commands = convertCommands({
    sourceRoot,
    destinationRoot: resolvedDestination,
    ignoreConfigPath,
    clean: false,
  });
  const rules = convertRules({
    sourceRoot,
    destinationRoot: resolvedDestination,
    ignoreConfigPath,
    clean: false,
  });
  const hooks = convertHooks({
    sourceRoot,
    destinationRoot: resolvedDestination,
    clean: false,
  });
  const manifestPath = writePluginManifest({
    destinationRoot: resolvedDestination,
    skills,
    agents,
    commands,
    rules,
    hooks,
  });
  const reportPath = writeConversionReport({
    destinationRoot: resolvedDestination,
    sourceRoot,
    skills,
    agents,
    commands,
    rules,
    hooks,
  });

  return {
    destinationRoot: resolvedDestination,
    manifestPath,
    reportPath,
    counts: {
      skills: skills.length,
      agents: agents.length,
      commands: commands.length,
      rules: rules.length,
      hooks: hooks.length,
    },
  };
}

module.exports = {
  DEFAULT_AGENT_MODEL_CONFIG,
  BODY_REPLACEMENTS,
  DEFAULT_CONFIG_PATH,
  DEFAULT_DESTINATION_ROOT,
  DEFAULT_IGNORE_CONFIG,
  DEFAULT_IGNORE_CONFIG_PATH,
  DEFAULT_REPO_URL,
  DEFAULT_SOURCE_ROOT,
  SOURCE_DIRECTORIES,
  buildCursorPlugin,
  convertAgents,
  convertCommands,
  convertHooks,
  convertRules,
  convertSkills,
  loadAgentModelConfig,
  loadIgnoreConfig,
  locateSourceDirectories,
  normalizeBodyContent,
  pathExists,
  resolveAgentCategory,
  resolveAgentModel,
  writeConversionReport,
  writePluginManifest,
};
