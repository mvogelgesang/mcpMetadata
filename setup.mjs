#!/usr/bin/env node

/**
 * MCP Metadata Setup Wizard
 * 
 * Configures Salesforce metadata files for your MCP server integration.
 * No dependencies required - uses only Node.js built-in modules.
 */

import { createInterface } from 'readline';
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'fs';
import { join, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// =============================================================================
// Configuration
// =============================================================================

/** Templates always ship next to this script (package root when published). */
const TEMPLATE_ROOT = join(__dirname, 'force-app', 'main', 'default');
const TEMPLATE_NAME = 'template';
const TEMPLATE_NAME_NOAUTH = 'template-noauth';
const MCP_PROTOCOL_VERSION = '2025-06-18';

const AUTH_TYPES = {
  OAUTH: 'OAuth',
  NO_AUTH: 'NoAuth',
};

const VARIABLES = [
  {
    key: 'MCP_NAME',
    prompt: 'MCP server name',
    description: 'A unique identifier for your MCP server (e.g., weatherApi, SlackMcp).\nOnly letters are allowed; no numbers or underscores.\nThis will be used for file names and labels in Salesforce.',
    validate: (val) => /^[a-zA-Z]+$/.test(val),
    error: 'Only letters (uppercase and/or lowercase) are allowed. No numbers or underscores.',
  },
  {
    key: 'MCP_SERVER_URL',
    prompt: 'MCP server URL',
    description: 'The full URL of your MCP server endpoint.\nExample: https://mcp.example.com/api',
    validate: (val) => /^https?:\/\/.+/.test(val),
    error: 'Must be a valid URL starting with https://',
  },
  {
    key: 'AUTH_TYPE',
    prompt: 'Authentication type',
    description: 'How Salesforce should authenticate to your MCP server.',
    choices: [
      { value: AUTH_TYPES.OAUTH, label: 'OAuth 2.0 Client Credentials' },
      { value: AUTH_TYPES.NO_AUTH, label: 'No Authentication' },
    ],
    defaultValue: AUTH_TYPES.OAUTH,
  },
  {
    key: 'AUTH_PROVIDER_URL',
    prompt: 'OAuth token endpoint URL',
    description: 'The OAuth 2.0 token endpoint for authentication.\nExample: https://auth.example.com/oauth/token',
    validate: (val) => /^https?:\/\/.+/.test(val),
    error: 'Must be a valid URL starting with https://',
    condition: (values) => values.AUTH_TYPE === AUTH_TYPES.OAUTH,
  },
  {
    key: 'NAMESPACE',
    prompt: 'Salesforce namespace (optional)',
    description: 'Your Salesforce namespace prefix, if applicable.\nLeave empty if you don\'t have a namespace.',
    validate: (val) => val === '' || /^[a-zA-Z][a-zA-Z0-9_]*$/.test(val),
    error: 'Must start with a letter and contain only letters, numbers, and underscores.',
    optional: true,
  },
];

const FILES = [
  {
    dir: 'externalCredentials',
    oldName: (authType) => `${authType === AUTH_TYPES.NO_AUTH ? TEMPLATE_NAME_NOAUTH : TEMPLATE_NAME}.externalCredential-meta.xml`,
    newName: (name) => `${name}.externalCredential-meta.xml`,
  },
  {
    dir: 'externalServiceRegistrations',
    oldName: () => `${TEMPLATE_NAME}.externalServiceRegistration-meta.xml`,
    newName: (name) => `${name}.externalServiceRegistration-meta.xml`,
  },
  {
    dir: 'namedCredentials',
    oldName: () => `${TEMPLATE_NAME}.namedCredential-meta.xml`,
    newName: (name) => `${name}.namedCredential-meta.xml`,
  },
  {
    dir: 'permissionsets',
    oldName: () => `${TEMPLATE_NAME}_Perm_Set.permissionset-meta.xml`,
    newName: (name) => `${name}_Perm_Set.permissionset-meta.xml`,
  },
];

/** True when this script lives under node_modules (npm / npx install). */
const isInstalledFromNpm = () => __dirname.replace(/\\/g, '/').includes('/node_modules/');

/** Map of value-bearing flag → key used in the values map. */
const VALUE_FLAGS = {
  '--mcp-name': 'MCP_NAME',
  '--mcp-server-url': 'MCP_SERVER_URL',
  '--auth-type': 'AUTH_TYPE',
  '--auth-provider-url': 'AUTH_PROVIDER_URL',
  '--namespace': 'NAMESPACE',
};

/** Normalize --auth-type input to the canonical AUTH_TYPES value, or null if unknown. */
const normalizeAuthType = (raw) => {
  const v = String(raw).trim().toLowerCase();
  if (v === 'oauth' || v === 'oauth2' || v === AUTH_TYPES.OAUTH.toLowerCase()) return AUTH_TYPES.OAUTH;
  if (v === 'noauth' || v === 'no-auth' || v === 'none' || v === AUTH_TYPES.NO_AUTH.toLowerCase()) return AUTH_TYPES.NO_AUTH;
  return null;
};

const parseCliArgs = (argv) => {
  const out = { target: null, help: false, overwrite: false, values: {} };

  const setValueFlag = (flag, raw) => {
    const key = VALUE_FLAGS[flag];
    if (key === 'AUTH_TYPE') {
      const normalized = normalizeAuthType(raw);
      if (!normalized) {
        log.error(`${flag}: must be one of "oauth" or "noauth" (got "${raw}")`);
        process.exit(1);
      }
      out.values[key] = normalized;
      return;
    }
    out.values[key] = raw;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--help' || arg === '-h') {
      out.help = true;
      continue;
    }

    if (arg === '--overwrite' || arg === '--force') {
      out.overwrite = true;
      continue;
    }

    // Support --key=value
    const eqIdx = arg.indexOf('=');
    if (arg.startsWith('--') && eqIdx > 2) {
      const flag = arg.slice(0, eqIdx);
      const raw = arg.slice(eqIdx + 1);
      if (flag === '--target') {
        out.target = resolve(process.cwd(), raw);
        continue;
      }
      if (flag in VALUE_FLAGS) {
        setValueFlag(flag, raw);
        continue;
      }
      log.error(`Unknown flag: ${flag}`);
      process.exit(1);
    }

    // Support --key value
    if (arg === '--target') {
      if (!argv[i + 1]) {
        log.error('--target requires a path argument');
        process.exit(1);
      }
      out.target = resolve(process.cwd(), argv[i + 1]);
      i += 1;
      continue;
    }

    if (arg in VALUE_FLAGS) {
      if (argv[i + 1] === undefined) {
        log.error(`${arg} requires a value`);
        process.exit(1);
      }
      setValueFlag(arg, argv[i + 1]);
      i += 1;
      continue;
    }

    if (arg.startsWith('-')) {
      log.error(`Unknown flag: ${arg}`);
      process.exit(1);
    }
  }

  return out;
};

/**
 * Directory where generated metadata is written.
 * From npm/npx: cwd/force-app/main/default. From a clone: same as templates unless --target is set.
 */
const resolveOutputRoot = (cli) => {
  if (cli.target) {
    const t = cli.target;
    if (existsSync(join(t, 'force-app', 'main', 'default'))) {
      return join(t, 'force-app', 'main', 'default');
    }
    if (existsSync(join(t, 'externalCredentials')) || existsSync(join(t, 'namedCredentials'))) {
      return t;
    }
    return join(t, 'force-app', 'main', 'default');
  }
  if (isInstalledFromNpm()) {
    return join(process.cwd(), 'force-app', 'main', 'default');
  }
  return join(__dirname, 'force-app', 'main', 'default');
};

// =============================================================================
// Colors (ANSI escape codes)
// =============================================================================

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

const log = {
  header: (msg) => console.log(`\n${c.blue}${'━'.repeat(70)}${c.reset}\n${c.bold}${c.cyan}  ${msg}${c.reset}\n${c.blue}${'━'.repeat(70)}${c.reset}\n`),
  success: (msg) => console.log(`${c.green}✔${c.reset}  ${msg}`),
  error: (msg) => console.log(`${c.red}✖${c.reset}  ${msg}`),
  warning: (msg) => console.log(`${c.yellow}⚠${c.reset}  ${msg}`),
  info: (msg) => console.log(`${c.cyan}ℹ${c.reset}  ${msg}`),
};

// =============================================================================
// Readline Interface
// =============================================================================

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
});

const prompt = (question) => new Promise((resolve) => rl.question(question, resolve));

const promptWithValidation = async (variable) => {
  console.log(`\n${c.bold}${variable.key}${c.reset}`);
  console.log(`${c.cyan}${variable.description}${c.reset}`);

  while (true) {
    const suffix = variable.optional ? ' (press Enter to skip)' : '';
    const answer = await prompt(`${c.green}▸${c.reset} ${variable.prompt}${suffix}: `);

    if (variable.validate(answer)) {
      return answer;
    }
    log.error(variable.error);
  }
};

const promptChoice = async (variable) => {
  console.log(`\n${c.bold}${variable.key}${c.reset}`);
  console.log(`${c.cyan}${variable.description}${c.reset}`);

  variable.choices.forEach((choice, idx) => {
    const marker = choice.value === variable.defaultValue ? ' (default)' : '';
    console.log(`  ${c.bold}${idx + 1}.${c.reset} ${choice.label}${marker}`);
  });

  const defaultIdx = variable.choices.findIndex((ch) => ch.value === variable.defaultValue);
  const defaultLabel = defaultIdx >= 0 ? `${defaultIdx + 1}` : '';

  while (true) {
    const suffix = defaultLabel ? ` [${defaultLabel}]` : '';
    const answer = (await prompt(`${c.green}▸${c.reset} ${variable.prompt}${suffix}: `)).trim();
    if (answer === '' && variable.defaultValue !== undefined) {
      return variable.defaultValue;
    }
    const num = Number.parseInt(answer, 10);
    if (Number.isInteger(num) && num >= 1 && num <= variable.choices.length) {
      return variable.choices[num - 1].value;
    }
    const matched = variable.choices.find((ch) => ch.value.toLowerCase() === answer.toLowerCase());
    if (matched) return matched.value;
    log.error(`Enter a number between 1 and ${variable.choices.length}.`);
  }
};

// =============================================================================
// File Operations
// =============================================================================

const applyReplacements = (content, replacements) => {
  let result = content;
  for (const [search, replace] of Object.entries(replacements)) {
    result = result.replaceAll(search, replace);
  }
  return result;
};

/** Copy template to new path with replacements applied. Leaves template unchanged. */
const copyFromTemplate = (templatePath, newPath, replacements) => {
  const content = readFileSync(templatePath, 'utf8');
  const newContent = applyReplacements(content, replacements);
  mkdirSync(dirname(newPath), { recursive: true });
  writeFileSync(newPath, newContent, 'utf8');
};

/** Returns true if any of the metadata files for this MCP_NAME already exist. */
const instanceExists = (mcpName, outputRoot) => {
  return FILES.some((file) => {
    const path = join(outputRoot, file.dir, file.newName(mcpName));
    return existsSync(path);
  });
};

/** Derive existing MCP instance names from externalCredentials dir (canonical source). */
const getExistingInstances = (outputRoot) => {
  const dir = join(outputRoot, 'externalCredentials');
  if (!existsSync(dir)) return [];
  const names = new Set();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const match = entry.name.match(/^(.+)\.externalCredential-meta\.xml$/);
    if (match && match[1] !== TEMPLATE_NAME && match[1] !== TEMPLATE_NAME_NOAUTH) {
      names.add(match[1]);
    }
  }
  return [...names].sort();
};

// =============================================================================
// XML escape and minimal schema/serviceBinding stubs
// =============================================================================

/** Escape a string for safe use inside XML element content. */
const escapeXml = (str) => {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
};

/** Minimal schema stub when fetch is skipped or fails. */
const getMinimalSchema = (mcpName) => ({
  serverDescriptor: {
    protocolVersion: MCP_PROTOCOL_VERSION,
    serverInfo: { name: mcpName, version: '1.0.0' },
  },
  tools: [],
  resources: [],
});

/** Minimal serviceBinding stub when fetch is skipped or fails. */
const getMinimalServiceBinding = (mcpName) => ({
  protocolVersion: MCP_PROTOCOL_VERSION,
  serverInfo: { name: mcpName, version: '1.0.0' },
  instructions: null,
});

// =============================================================================
// Main
// =============================================================================

const main = async () => {
  const cli = parseCliArgs(process.argv.slice(2));
  if (cli.help) {
    console.log(`
MCP Metadata Setup — Salesforce MCP metadata wizard

Usage:
  node setup.mjs [options]
  npm create @mvogelgesang/sf-mcp-client-metadata@latest -- [options]

Options:
  --target <path>            SFDX project root, or path to force-app/main/default
  --mcp-name <name>          Unique identifier for the MCP server (letters only)
  --mcp-server-url <url>     MCP server endpoint URL (http(s)://...)
  --auth-type <type>         Authentication type: oauth | noauth (default: oauth)
  --auth-provider-url <url>  OAuth token endpoint URL (required when auth-type=oauth)
  --namespace <ns>           Salesforce namespace prefix (optional; pass "" for none)
  --overwrite, --force       Overwrite an existing MCP instance without prompting
  -h, --help                 Show this message

Flags accept --key value or --key=value.

When all required flags are provided (--mcp-name, --mcp-server-url, --auth-type,
and --auth-provider-url when auth-type=oauth) the wizard runs non-interactively
and applies changes without confirmation prompts.

When installed via npm/npx, files are written under the current directory's
force-app/main/default/. When run from a clone, files default to this repo's
force-app/main/default/ unless --target is set.
`);
    process.exit(0);
  }

  // Validate any CLI-provided values up front against the same predicates used
  // for interactive prompts; fail fast on bad flag values.
  const flagToOption = {
    MCP_NAME: '--mcp-name',
    MCP_SERVER_URL: '--mcp-server-url',
    AUTH_TYPE: '--auth-type',
    AUTH_PROVIDER_URL: '--auth-provider-url',
    NAMESPACE: '--namespace',
  };
  for (const variable of VARIABLES) {
    const raw = cli.values[variable.key];
    if (raw === undefined) continue;
    if (variable.choices) {
      const allowed = variable.choices.map((ch) => ch.value);
      if (!allowed.includes(raw)) {
        log.error(`${flagToOption[variable.key]}: must be one of ${allowed.join(', ')} (got "${raw}")`);
        process.exit(1);
      }
      continue;
    }
    if (typeof variable.validate === 'function' && !variable.validate(raw)) {
      log.error(`${flagToOption[variable.key]}: ${variable.error}`);
      process.exit(1);
    }
  }

  // Warn (but don't fail) if --auth-provider-url was passed alongside noauth.
  if (cli.values.AUTH_TYPE === AUTH_TYPES.NO_AUTH && cli.values.AUTH_PROVIDER_URL) {
    log.warning('--auth-provider-url is ignored when --auth-type=noauth.');
    delete cli.values.AUTH_PROVIDER_URL;
  }

  // Compute non-interactive mode: every required value must be set via flags.
  const effectiveAuthType = cli.values.AUTH_TYPE ?? null;
  const nonInteractive = Boolean(
    cli.values.MCP_NAME &&
    cli.values.MCP_SERVER_URL &&
    effectiveAuthType &&
    (effectiveAuthType === AUTH_TYPES.NO_AUTH || cli.values.AUTH_PROVIDER_URL)
  );

  const outputRoot = resolveOutputRoot(cli);

  if (!nonInteractive) console.clear();
  log.header('MCP Metadata Setup Wizard');

  log.info(`Metadata output: ${outputRoot}`);

  if (!nonInteractive) {
    console.log('This wizard will configure the Salesforce metadata files for your');
    console.log('Model Context Protocol (MCP) server integration.\n');
    console.log('You\'ll be prompted for the following values:');
    VARIABLES.forEach((v, i) => {
      const opt = v.optional ? ' (optional)' : '';
      console.log(`  ${c.bold}${i + 1}.${c.reset} ${v.key}${opt}`);
    });
    await prompt(`\n${c.yellow}Press Enter to continue or Ctrl+C to cancel...${c.reset}`);
  }

  // Gather values
  log.header('Step 1: Configuration Values');

  const existing = getExistingInstances(outputRoot);
  if (existing.length > 0) {
    log.info(`Existing MCP instances: ${existing.join(', ')}`);
  }

  // Pre-populate from CLI flags so the loop below skips already-known values.
  const values = { ...cli.values };
  for (const variable of VARIABLES) {
    if (variable.condition && !variable.condition(values)) continue;
    if (values[variable.key] !== undefined) {
      log.info(`${variable.key}: ${values[variable.key] || '(none)'} (from --${variable.key.toLowerCase().replaceAll('_', '-')})`);
      continue;
    }
    // In non-interactive mode, optional variables default to empty rather than blocking on a prompt.
    if (nonInteractive && variable.optional) {
      values[variable.key] = '';
      continue;
    }
    if (variable.choices) {
      values[variable.key] = await promptChoice(variable);
    } else {
      values[variable.key] = await promptWithValidation(variable);
    }
  }
  const authType = values.AUTH_TYPE ?? AUTH_TYPES.OAUTH;
  const isNoAuth = authType === AUTH_TYPES.NO_AUTH;

  // Schema and service binding always use a minimal stub; tools refresh after
  // deploy in Setup → Agentforce Registry.
  const schemaObj = getMinimalSchema(values.MCP_NAME);
  const serviceBindingObj = getMinimalServiceBinding(values.MCP_NAME);

  const schemaJsonEscaped = escapeXml(JSON.stringify(schemaObj));
  const serviceBindingJsonEscaped = escapeXml(JSON.stringify(serviceBindingObj));

  // Build replacements map
  const namespacePrefix = values.NAMESPACE ? `${values.NAMESPACE}__` : '';
  const replacements = {
    'MCP_NAME': values.MCP_NAME,
    'MCP_SERVER_URL': values.MCP_SERVER_URL,
    'NAMESPACE__': namespacePrefix,
    'SCHEMA_JSON': schemaJsonEscaped,
    'SERVICE_BINDING_JSON': serviceBindingJsonEscaped,
  };
  if (values.AUTH_PROVIDER_URL) {
    replacements['AUTH_PROVIDER_URL'] = values.AUTH_PROVIDER_URL;
  }

  // Show summary
  log.header('Step 2: Review Configuration');

  const authTypeLabel = isNoAuth ? 'No Authentication' : 'OAuth 2.0 Client Credentials';

  console.log('Please review your configuration:\n');
  console.log(`  ${c.bold}MCP_NAME:${c.reset}          ${values.MCP_NAME}`);
  console.log(`  ${c.bold}MCP_SERVER_URL:${c.reset}    ${values.MCP_SERVER_URL}`);
  console.log(`  ${c.bold}AUTH_TYPE:${c.reset}         ${authTypeLabel}`);
  if (values.AUTH_PROVIDER_URL) {
    console.log(`  ${c.bold}AUTH_PROVIDER_URL:${c.reset} ${values.AUTH_PROVIDER_URL}`);
  }
  console.log(`  ${c.bold}NAMESPACE:${c.reset}         ${values.NAMESPACE || '(none)'}`);

  console.log(`\n${c.bold}Files to be written under:${c.reset} ${outputRoot}\n`);
  console.log(`${c.bold}Files to be updated:${c.reset}`);
  for (const file of FILES) {
    const templateFile = file.oldName(authType);
    console.log(`  • ${file.dir}/${templateFile}`);
    console.log(`    → ${file.dir}/${file.newName(values.MCP_NAME)}\n`);
  }

  if (!nonInteractive) {
    const confirm = await prompt(`${c.yellow}Apply these changes? (y/n): ${c.reset}`);
    if (confirm.toLowerCase() !== 'y') {
      console.log('');
      log.warning('Setup cancelled. No changes were made.');
      rl.close();
      process.exit(0);
    }
  }

  // Check for existing instance and confirm overwrite if needed
  if (instanceExists(values.MCP_NAME, outputRoot)) {
    if (nonInteractive) {
      if (!cli.overwrite) {
        console.log('');
        log.error(`Metadata for '${values.MCP_NAME}' already exists. Pass --overwrite to replace it.`);
        rl.close();
        process.exit(1);
      }
    } else {
      const overwrite = cli.overwrite
        ? 'y'
        : await prompt(`${c.yellow}Metadata for '${values.MCP_NAME}' already exists. Overwrite? (y/n): ${c.reset}`);
      if (overwrite.toLowerCase() !== 'y') {
        console.log('');
        log.warning('Setup cancelled. No changes were made.');
        rl.close();
        process.exit(0);
      }
    }
  }

  // Apply changes (copy from template; templates are left unchanged for future runs)
  log.header('Step 3: Applying Changes');
  
  for (const file of FILES) {
    const templateFile = file.oldName(authType);
    const templatePath = join(TEMPLATE_ROOT, file.dir, templateFile);
    const newPath = join(outputRoot, file.dir, file.newName(values.MCP_NAME));

    if (!existsSync(templatePath)) {
      log.error(`Template not found: ${templateFile}`);
      continue;
    }

    copyFromTemplate(templatePath, newPath, replacements);
    log.success(`Created: ${file.newName(values.MCP_NAME)}`);
  }
  
  // Complete
  log.header('Setup Complete!');

  const permSetName = `${values.MCP_NAME}_Perm_Set`;

  console.log('Your MCP metadata files have been configured successfully.\n');
  console.log(`${c.bold}Next steps${c.reset} — run the Salesforce CLI from your SFDX project root`);
  console.log(`(the directory that contains \`force-app\`; metadata was written under:\n  ${outputRoot})\n`);
  const m = values.MCP_NAME;
  const deployOnlyNew = `sf project deploy start --metadata ExternalCredential:${m} --metadata NamedCredential:${m} --metadata ExternalServiceRegistration:${m} --metadata PermissionSet:${permSetName}`;
  console.log(`  ${c.bold}1)${c.reset} Deploy only the new MCP metadata to your org`);
  console.log(`     ${c.cyan}${deployOnlyNew}${c.reset}`);
  console.log('     (add --target-org <alias> if your default org is not set)\n');
  console.log(`  ${c.bold}2)${c.reset} Assign the MCP permission set to your user (or another user)`);
  console.log(`     ${c.cyan}sf org assign permset -n ${permSetName}${c.reset}\n`);
  console.log(`${c.bold}After deploy${c.reset} — finish MCP setup in Setup:`);
  if (isNoAuth) {
    console.log(`  • ${c.cyan}Setup → Named Credentials → External Credentials → ${values.MCP_NAME}${c.reset}`);
    console.log('    → No Authentication: nothing to configure on Principals.');
  } else {
    console.log(`  • ${c.cyan}Setup → Named Credentials → External Credentials → ${values.MCP_NAME}${c.reset}`);
    console.log('    → Principals → enter Client Id and Client Secret → Save');
  }
  console.log(`  • ${c.cyan}Setup → Agentforce Registry → ${values.MCP_NAME}${c.reset} → Edit tools if needed`);
  console.log('');
  log.success('Happy coding!');
  console.log('');
  
  rl.close();
};

main().catch((err) => {
  log.error(err.message);
  rl.close();
  process.exit(1);
});
