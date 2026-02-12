/**
 * AGENTS.md Generator
 *
 * Generates a lightweight project-specific AGENTS.md file.
 * AGENTS.md lives at the project root (for OpenAI Codex CLI compatibility).
 *
 * If AGENTS.md already exists, the Traffical section is appended or updated.
 *
 * For comprehensive SDK usage, CLI workflow, and best practices documentation,
 * see the installable Traffical skill: npx skills add traffical/skills
 */

import type { Framework } from "./detection.ts";
import { getSdkPackage, getFrameworkDisplayName } from "./detection.ts";
import type { ConfigParameter } from "./types.ts";
import {
  TRAFFICAL_AGENTS_MARKER,
  TRAFFICAL_AGENTS_MARKER_END,
} from "./config.ts";

export interface AgentsMdOptions {
  projectName: string;
  orgName: string;
  framework: Framework;
  language: string;
  parameters: Record<string, ConfigParameter>;
}

/**
 * Generate the Traffical section content (without markers).
 */
function generateTrafficalSection(options: AgentsMdOptions): string {
  const { projectName, orgName, framework, parameters } = options;
  const sdkPackage = getSdkPackage(framework);
  const frameworkName = getFrameworkDisplayName(framework);

  const sections = [
    generateHeader(projectName, orgName, frameworkName, sdkPackage),
    generateParameterList(parameters),
    generatePointers(),
  ];

  return sections.join("\n\n");
}

/**
 * Generate the complete AGENTS.md content (for new files).
 */
export function generateAgentsMd(options: AgentsMdOptions): string {
  const content = generateTrafficalSection(options);
  return `${TRAFFICAL_AGENTS_MARKER}\n${content}\n${TRAFFICAL_AGENTS_MARKER_END}\n`;
}

/**
 * Update an existing AGENTS.md by replacing the Traffical section.
 * If no Traffical section exists, appends it.
 *
 * @param existingContent - The current content of AGENTS.md
 * @param options - Options for generating the Traffical section
 * @returns Updated content
 */
export function updateAgentsMd(existingContent: string, options: AgentsMdOptions): string {
  const markerPattern = new RegExp(
    `${escapeRegex(TRAFFICAL_AGENTS_MARKER)}[\\s\\S]*?${escapeRegex(TRAFFICAL_AGENTS_MARKER_END)}`,
    "g"
  );

  const newSection = `${TRAFFICAL_AGENTS_MARKER}\n${generateTrafficalSection(options)}\n${TRAFFICAL_AGENTS_MARKER_END}`;

  if (existingContent.includes(TRAFFICAL_AGENTS_MARKER)) {
    // Replace existing Traffical section
    return existingContent.replace(markerPattern, newSection);
  } else {
    // Append new section
    return existingContent.trimEnd() + `\n\n---\n\n${newSection}\n`;
  }
}

/**
 * Escape special regex characters in a string.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function generateHeader(
  projectName: string,
  orgName: string,
  frameworkName: string,
  sdkPackage: string
): string {
  return `# Traffical Integration

This project uses **Traffical** for feature flags, A/B testing, and experimentation.

| Resource | Location |
|----------|----------|
| **Project** | ${projectName} (${orgName}) |
| **Config** | \`.traffical/config.yaml\` |
| **SDK Package** | \`${sdkPackage}\` |
| **Framework** | ${frameworkName} |
| **Code Patterns** | \`.traffical/TEMPLATES.md\` |
| **SDK Key** | \`.traffical/.env\` → \`TRAFFICAL_API_KEY\` |`;
}

function generateParameterList(parameters: Record<string, ConfigParameter>): string {
  const keys = Object.keys(parameters);

  if (keys.length === 0) {
    return `## Parameters

No parameters configured yet. Add them to \`.traffical/config.yaml\` and run \`npx @traffical/cli push\`.`;
  }

  const rows = keys.map((key) => {
    const param = parameters[key]!;
    const defaultStr = JSON.stringify(param.default);
    return `| \`${key}\` | ${param.type} | \`${defaultStr}\` |`;
  });

  return `## Parameters

| Parameter | Type | Default |
|-----------|------|---------|
${rows.join("\n")}`;
}

function generatePointers(): string {
  return `## Getting Started

1. Check \`.traffical/config.yaml\` for existing parameters before creating new ones
2. See \`.traffical/TEMPLATES.md\` for framework-specific code patterns
3. Run \`npx @traffical/cli push\` after modifying config
4. Run \`npx @traffical/cli status\` to check sync state

## Full Documentation

For comprehensive SDK usage, CLI workflow, authentication, and best practices, install the Traffical agent skill:

\`\`\`bash
npx skills add traffical/skills
\`\`\`

Or see https://docs.traffical.io`;
}
