#!/usr/bin/env node

/**
 * MCP Metadata Setup Wizard
 * 
 * Configures Salesforce metadata files for your MCP server integration.
 * No dependencies required - uses only Node.js built-in modules.
 */

import { createInterface } from 'readline';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// =============================================================================
// Configuration
// =============================================================================

const FORCE_APP_DIR = join(__dirname, 'force-app', 'main', 'default');
const TEMPLATE_NAME = 'template';

const VARIABLES = [
  {
    key: 'MCP_NAME',
    prompt: 'MCP server name',
    description: 'A unique identifier for your MCP server (e.g., weather_api, slack_mcp).\nThis will be used for file names and labels in Salesforce.',
    validate: (val) => /^[a-zA-Z][a-zA-Z0-9_]*$/.test(val),
    error: 'Must start with a letter and contain only letters, numbers, and underscores.',
  },
  {
    key: 'MCP_SERVER_URL',
    prompt: 'MCP server URL',
    description: 'The full URL of your MCP server endpoint.\nExample: https://mcp.example.com/api',
    validate: (val) => /^https?:\/\/.+/.test(val),
    error: 'Must be a valid URL starting with http:// or https://',
  },
  {
    key: 'AUTH_PROVIDER_URL',
    prompt: 'OAuth token endpoint URL',
    description: 'The OAuth 2.0 token endpoint for authentication.\nExample: https://auth.example.com/oauth/token',
    validate: (val) => /^https?:\/\/.+/.test(val),
    error: 'Must be a valid URL starting with http:// or https://',
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
    oldName: `${TEMPLATE_NAME}.externalCredential-meta.xml`,
    newName: (name) => `${name}.externalCredential-meta.xml`,
  },
  {
    dir: 'externalServiceRegistrations',
    oldName: `${TEMPLATE_NAME}.externalServiceRegistration-meta.xml`,
    newName: (name) => `${name}.externalServiceRegistration-meta.xml`,
  },
  {
    dir: 'namedCredentials',
    oldName: `${TEMPLATE_NAME}.namedCredential-meta.xml`,
    newName: (name) => `${name}.namedCredential-meta.xml`,
  },
  {
    dir: 'permissionsets',
    oldName: `${TEMPLATE_NAME}_Perm_Set.permissionset-meta.xml`,
    newName: (name) => `${name}_Perm_Set.permissionset-meta.xml`,
  },
];

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
  writeFileSync(newPath, newContent, 'utf8');
};

/** Returns true if any of the four metadata files for this MCP_NAME exist. */
const instanceExists = (mcpName) => {
  return FILES.some((file) => {
    const path = join(FORCE_APP_DIR, file.dir, file.newName(mcpName));
    return existsSync(path);
  });
};

/** Derive existing MCP instance names from externalCredentials dir (canonical source). */
const getExistingInstances = () => {
  const dir = join(FORCE_APP_DIR, 'externalCredentials');
  if (!existsSync(dir)) return [];
  const names = new Set();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const match = entry.name.match(/^(.+)\.externalCredential-meta\.xml$/);
    if (match && match[1] !== TEMPLATE_NAME) names.add(match[1]);
  }
  return [...names].sort();
};

// =============================================================================
// Main
// =============================================================================

const main = async () => {
  console.clear();
  log.header('MCP Metadata Setup Wizard');
  
  console.log('This wizard will configure the Salesforce metadata files for your');
  console.log('Model Context Protocol (MCP) server integration.\n');
  console.log('You\'ll be prompted for the following values:');
  VARIABLES.forEach((v, i) => {
    const opt = v.optional ? ' (optional)' : '';
    console.log(`  ${c.bold}${i + 1}.${c.reset} ${v.key}${opt}`);
  });
  
  await prompt(`\n${c.yellow}Press Enter to continue or Ctrl+C to cancel...${c.reset}`);
  
  // Gather values
  log.header('Step 1: Configuration Values');
  
  const existing = getExistingInstances();
  if (existing.length > 0) {
    log.info(`Existing MCP instances: ${existing.join(', ')}`);
  }

  const values = {};
  for (const variable of VARIABLES) {
    values[variable.key] = await promptWithValidation(variable);
  }
  
  // Build replacements map
  const namespacePrefix = values.NAMESPACE ? `${values.NAMESPACE}__` : '';
  const replacements = {
    'MCP_NAME': values.MCP_NAME,
    'MCP_SERVER_URL': values.MCP_SERVER_URL,
    'AUTH_PROVIDER_URL': values.AUTH_PROVIDER_URL,
    'NAMESPACE__': namespacePrefix,
  };
  
  // Show summary
  log.header('Step 2: Review Configuration');
  
  console.log('Please review your configuration:\n');
  console.log(`  ${c.bold}MCP_NAME:${c.reset}          ${values.MCP_NAME}`);
  console.log(`  ${c.bold}MCP_SERVER_URL:${c.reset}    ${values.MCP_SERVER_URL}`);
  console.log(`  ${c.bold}AUTH_PROVIDER_URL:${c.reset} ${values.AUTH_PROVIDER_URL}`);
  console.log(`  ${c.bold}NAMESPACE:${c.reset}         ${values.NAMESPACE || '(none)'}`);
  
  console.log(`\n${c.bold}Files to be updated:${c.reset}`);
  for (const file of FILES) {
    console.log(`  • ${file.dir}/${file.oldName}`);
    console.log(`    → ${file.dir}/${file.newName(values.MCP_NAME)}\n`);
  }
  
  const confirm = await prompt(`${c.yellow}Apply these changes? (y/n): ${c.reset}`);
  
  if (confirm.toLowerCase() !== 'y') {
    console.log('');
    log.warning('Setup cancelled. No changes were made.');
    rl.close();
    process.exit(0);
  }
  
  // Check for existing instance and confirm overwrite if needed
  if (instanceExists(values.MCP_NAME)) {
    const overwrite = await prompt(`${c.yellow}Metadata for '${values.MCP_NAME}' already exists. Overwrite? (y/n): ${c.reset}`);
    if (overwrite.toLowerCase() !== 'y') {
      console.log('');
      log.warning('Setup cancelled. No changes were made.');
      rl.close();
      process.exit(0);
    }
  }

  // Apply changes (copy from template; templates are left unchanged for future runs)
  log.header('Step 3: Applying Changes');
  
  for (const file of FILES) {
    const templatePath = join(FORCE_APP_DIR, file.dir, file.oldName);
    const newPath = join(FORCE_APP_DIR, file.dir, file.newName(values.MCP_NAME));
    
    if (!existsSync(templatePath)) {
      log.error(`Template not found: ${file.oldName}`);
      continue;
    }
    
    copyFromTemplate(templatePath, newPath, replacements);
    log.success(`Created: ${file.newName(values.MCP_NAME)}`);
  }
  
  // Complete
  log.header('Setup Complete!');
  
  console.log('Your MCP metadata files have been configured successfully.\n');
  console.log(`${c.bold}Next Steps:${c.reset}`);
  console.log('  1. Review the updated files in force-app/main/default/');
  console.log('  2. Deploy to your Salesforce org:');
  console.log(`     ${c.cyan}sf project deploy start --source-dir force-app${c.reset}`);
  console.log('  3. Configure the Client ID and Client Secret in Salesforce Setup:');
  console.log(`     ${c.cyan}Setup → Named Credentials → External Credentials → ${values.MCP_NAME}${c.reset}`);
  console.log('  4. Assign the permission set to users who need access:');
  console.log(`     ${c.cyan}${values.MCP_NAME}_Perm_Set${c.reset}`);
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
