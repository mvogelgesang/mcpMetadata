# MCP Metadata for Salesforce (Closed Beta)

This repository contains Salesforce metadata templates for integrating a Model Context Protocol (MCP) server with Salesforce using Named Credentials and External Services.

The following metadata will only work for MCP Client Beta participants.

## What's Included

- **External Credential** - OAuth 2.0 client credentials configuration
- **Named Credential** - Secure endpoint configuration for your MCP server
- **External Service Registration** - MCP service registration
- **Permission Set** - Access permissions for the external credential

## Prerequisites

- Node.js 18+ installed
- Salesforce CLI (`sf`) installed
- A Salesforce org with API access
- Your MCP server details:
  - Server URL
  - OAuth token endpoint URL
  - Client ID and Client Secret

## Quick Start

### 1. Clone this repository

```bash
git clone <repository-url>
cd mcpMetadata
```

### 2. Run the setup wizard

```bash
node setup.mjs
```

The interactive wizard will prompt you for:

| Variable | Description | Example |
|----------|-------------|---------|
| `MCP_NAME` | Unique identifier for your MCP server | `weather_api` |
| `MCP_SERVER_URL` | Your MCP server endpoint URL | `https://mcp.example.com/api` |
| `AUTH_PROVIDER_URL` | OAuth 2.0 token endpoint | `https://auth.example.com/oauth/token` |
| `NAMESPACE` | Salesforce namespace (optional) | `mycompany` |

### 3. Deploy to Salesforce

```bash
sf project deploy start --source-dir force-app
```

### 4. Assign Permission Set to User

```bash
sf org assign permset -n {permission set name}`
```

### 5. Activate MCP Server Connection

1. [Workaround] Go to **Setup → Named Credentials → {MCP Server Name} → Click through to the External Credential
2. Scroll down to Principals → Edit → Enter Client Id and Secret → Save
3. Go to **Setup → Agentforce Registry → {MCP Server Name} → Edit
4. Leave content in modal as is → Save and Continue
5. Under Tools tab, Click Edit Tools. Full tool list will refresh

## File Structure

```
force-app/main/default/
├── externalCredentials/
│   └── <MCP_NAME>.externalCredential-meta.xml
├── externalServiceRegistrations/
│   └── <MCP_NAME>.externalServiceRegistration-meta.xml
├── namedCredentials/
│   └── <MCP_NAME>.namedCredential-meta.xml
└── permissionsets/
    └── <MCP_NAME>_Perm_Set.permissionset-meta.xml
```

## Configuration Variables

The setup script replaces the following placeholders:

| Placeholder | Description |
|-------------|-------------|
| `MCP_NAME` | Used in labels, API names, and file names |
| `MCP_SERVER_URL` | The MCP server endpoint URL |
| `AUTH_PROVIDER_URL` | OAuth token endpoint for authentication |
| `NAMESPACE__` | Namespace prefix for managed package references (empty if no namespace) |

## License

MIT
