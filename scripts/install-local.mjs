import { cp, lstat, mkdir, readFile, readdir, realpath, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const OWNED_PATHS = {
  sourceDir: path.join('.build', 'chrome-mv3'),
  destinationDir: path.join('.output', 'chrome-mv3'),
  stagingDir: path.join('.output', 'chrome-mv3.next'),
  backupDir: path.join('.output', 'chrome-mv3.previous'),
};

async function pathExists(targetPath) {
  try {
    await lstat(targetPath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function assertNoSymlinkComponents(repoRoot, targetPath) {
  const relativePath = path.relative(repoRoot, targetPath);
  let currentPath = repoRoot;

  for (const segment of relativePath.split(path.sep)) {
    currentPath = path.join(currentPath, segment);
    try {
      const metadata = await lstat(currentPath);
      if (metadata.isSymbolicLink()) {
        throw new Error(`Refusing symbolic link in local install path: ${currentPath}`);
      }
    } catch (error) {
      if (error?.code === 'ENOENT') return;
      throw error;
    }
  }
}

async function assertOwnedPaths(options) {
  const repoRoot = path.resolve(options.repoRoot);
  const resolvedRoot = await realpath(repoRoot);
  if (resolvedRoot !== repoRoot) {
    throw new Error(`Repository root must not resolve through a symbolic link: ${repoRoot}`);
  }

  for (const [name, relativePath] of Object.entries(OWNED_PATHS)) {
    const expectedPath = path.resolve(repoRoot, relativePath);
    const actualPath = path.resolve(options[name]);
    if (actualPath !== expectedPath) {
      throw new Error(`${name} must stay inside this repository at ${relativePath}`);
    }
    await assertNoSymlinkComponents(repoRoot, actualPath);
  }
}

function collectManifestReferences(manifest) {
  const references = new Set();
  const add = (value) => {
    if (typeof value === 'string' && value.length > 0) references.add(value);
  };
  const addAll = (values) => {
    if (Array.isArray(values)) values.forEach(add);
  };

  add(manifest.action?.default_popup);
  if (typeof manifest.action?.default_icon === 'string') add(manifest.action.default_icon);
  if (manifest.action?.default_icon && typeof manifest.action.default_icon === 'object') {
    Object.values(manifest.action.default_icon).forEach(add);
  }
  add(manifest.background?.service_worker);
  addAll(manifest.background?.scripts);
  add(manifest.background?.page);
  Object.values(manifest.icons ?? {}).forEach(add);
  Object.values(manifest.chrome_url_overrides ?? {}).forEach(add);
  add(manifest.options_ui?.page);
  add(manifest.options_page);
  add(manifest.devtools_page);
  add(manifest.side_panel?.default_path);
  addAll(manifest.sandbox?.pages);
  add(manifest.storage?.managed_schema);

  for (const entry of manifest.content_scripts ?? []) {
    addAll(entry.js);
    addAll(entry.css);
  }
  for (const ruleset of manifest.declarative_net_request?.rule_resources ?? []) {
    add(ruleset.path);
  }

  return references;
}

function resolveManifestReference(extensionDir, reference) {
  const resolvedPath = path.resolve(extensionDir, reference);
  const relativePath = path.relative(extensionDir, resolvedPath);
  if (
    path.isAbsolute(reference) ||
    relativePath === '..' ||
    relativePath.startsWith(`..${path.sep}`)
  ) {
    throw new Error(`Manifest reference escapes the extension directory: ${reference}`);
  }
  return resolvedPath;
}

async function collectSafeExtensionFiles(directory, rootDirectory = directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Refusing symbolic link inside extension tree: ${entryPath}`);
    }
    if (entry.isDirectory()) {
      files.push(...await collectSafeExtensionFiles(entryPath, rootDirectory));
    } else if (entry.isFile()) {
      files.push(path.relative(rootDirectory, entryPath).split(path.sep).join('/'));
    } else if (!entry.isFile()) {
      throw new Error(`Refusing non-file entry inside extension tree: ${entryPath}`);
    }
  }
  return files;
}

function normalizeWebAccessiblePattern(pattern) {
  if (typeof pattern !== 'string' || pattern.length === 0 || pattern.includes('\\')) {
    throw new Error(`Invalid web-accessible resource pattern: ${String(pattern)}`);
  }
  const normalizedPattern = pattern.startsWith('/') ? pattern.slice(1) : pattern;
  const segments = normalizedPattern.split('/');
  if (segments.includes('..')) {
    throw new Error(`Web-accessible resource pattern escapes the extension directory: ${pattern}`);
  }
  if (segments.some((segment) => segment.length === 0 || segment === '.')) {
    throw new Error(`Invalid web-accessible resource pattern: ${pattern}`);
  }
  return normalizedPattern;
}

function webAccessiblePatternRegex(pattern) {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replaceAll('*', '.*')}$`);
}

function validateWebAccessibleResources(manifest, extensionFiles) {
  for (const entry of manifest.web_accessible_resources ?? []) {
    for (const pattern of entry.resources ?? []) {
      const normalizedPattern = normalizeWebAccessiblePattern(pattern);
      const matches = webAccessiblePatternRegex(normalizedPattern);
      if (!extensionFiles.some((file) => matches.test(file))) {
        throw new Error(
          `Web-accessible resource pattern matched no regular files: ${pattern}`,
        );
      }
    }
  }
}

async function validateExtension(extensionDir) {
  let extensionMetadata;
  try {
    extensionMetadata = await lstat(extensionDir);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`Local install source is missing: ${extensionDir}`);
    }
    throw error;
  }
  if (!extensionMetadata.isDirectory()) {
    throw new Error(`Local install source is not a directory: ${extensionDir}`);
  }
  const extensionFiles = await collectSafeExtensionFiles(extensionDir);
  const manifestPath = path.join(extensionDir, 'manifest.json');
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch (error) {
    throw new Error(`Invalid or missing source manifest: ${manifestPath}`, { cause: error });
  }

  if (manifest.manifest_version !== 3) {
    throw new Error('Local install source must use Chrome Manifest V3');
  }
  if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') {
    throw new Error('Local install source manifest must include a name and version');
  }
  validateWebAccessibleResources(manifest, extensionFiles);

  for (const reference of collectManifestReferences(manifest)) {
    const referencedPath = resolveManifestReference(extensionDir, reference);
    let metadata;
    try {
      metadata = await lstat(referencedPath);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        throw new Error(`Manifest references missing file: ${reference}`);
      }
      throw error;
    }
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
      throw new Error(`Manifest reference must be a regular file: ${reference}`);
    }
  }
}

export async function installLocalExtension(options, fileOperations = {}) {
  if (!options.extensionDisabled) {
    throw new Error(
      'Disable RepoAura in chrome://extensions, then acknowledge with --extension-disabled.',
    );
  }

  await assertOwnedPaths(options);
  await validateExtension(options.sourceDir);
  const renamePath = fileOperations.rename ?? rename;

  await mkdir(path.dirname(options.stagingDir), { recursive: true });
  await rm(options.stagingDir, { recursive: true, force: true });
  try {
    await cp(options.sourceDir, options.stagingDir, {
      recursive: true,
      dereference: false,
      errorOnExist: true,
      force: false,
    });
    await validateExtension(options.stagingDir);
  } catch (error) {
    await rm(options.stagingDir, { recursive: true, force: true });
    throw error;
  }

  const hasDestination = await pathExists(options.destinationDir);
  if (hasDestination) {
    await rm(options.backupDir, { recursive: true, force: true });
    await renamePath(options.destinationDir, options.backupDir);
  }

  try {
    await renamePath(options.stagingDir, options.destinationDir);
  } catch (promotionError) {
    if (!hasDestination) {
      throw new Error('Local extension install failed before replacing an existing install.', {
        cause: promotionError,
      });
    }

    let destinationOccupied;
    try {
      destinationOccupied = await pathExists(options.destinationDir);
    } catch (inspectionError) {
      throw new Error(
        `Local extension install and recovery failed. Previous install remains at ${options.backupDir}.`,
        { cause: new AggregateError([promotionError, inspectionError]) },
      );
    }
    if (destinationOccupied) {
      throw new Error(
        `Local extension install and recovery failed because ${options.destinationDir} is occupied. ` +
          `Previous install remains at ${options.backupDir}; the unexpected destination was left untouched.`,
        { cause: promotionError },
      );
    }

    try {
      await renamePath(options.backupDir, options.destinationDir);
    } catch (recoveryError) {
      throw new Error(
        `Local extension install and recovery failed. Previous install remains at ${options.backupDir}.`,
        { cause: new AggregateError([promotionError, recoveryError]) },
      );
    }
    throw new Error('Local extension install failed; the previous install was restored.', {
      cause: promotionError,
    });
  }
}

async function runCli(args) {
  if (args.length !== 1 || args[0] !== '--extension-disabled') {
    const unexpected = args.filter((arg) => arg !== '--extension-disabled');
    if (unexpected.length > 0) {
      throw new Error(`Unexpected argument: ${unexpected.join(', ')}`);
    }
    throw new Error(
      'Disable RepoAura in chrome://extensions, then run with --extension-disabled.',
    );
  }

  const repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
  await installLocalExtension({
    repoRoot,
    sourceDir: path.join(repoRoot, OWNED_PATHS.sourceDir),
    destinationDir: path.join(repoRoot, OWNED_PATHS.destinationDir),
    stagingDir: path.join(repoRoot, OWNED_PATHS.stagingDir),
    backupDir: path.join(repoRoot, OWNED_PATHS.backupDir),
    extensionDisabled: true,
  });
  console.log('Installed .build/chrome-mv3 at stable path .output/chrome-mv3.');
  console.log('Previous install: .output/chrome-mv3.previous');
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedPath) {
  runCli(process.argv.slice(2)).catch((error) => {
    console.error(`Local install refused: ${error.message}`);
    process.exitCode = 1;
  });
}
