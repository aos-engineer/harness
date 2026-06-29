/**
 * Template Resolver — replaces {{VARIABLE}} placeholders with runtime values.
 * Unknown variables are left as-is (not removed, not errored).
 * Supports hyphenated variable names (e.g., {{profile-name}}).
 *
 * Special handling for optional variables (role_override):
 * - If the variable resolves to empty string AND the line contains only
 *   the variable placeholder (plus whitespace), the entire line is stripped.
 * - This prevents blank lines in prompts when optional variables are not set.
 */

const OPTIONAL_VARIABLES = new Set(["role_override"]);
const OPTIONAL_LINE_PATTERN = /^\s*\{\{([\w-]+)\}\}\s*$/;

export function resolveTemplate(
  template: string,
  variables: Record<string, string>,
): string {
  if (!template) return template;

  const lines = template.split("\n");
  const result: string[] = [];
  let skipNextBlank = false;

  for (const line of lines) {
    const match = line.match(OPTIONAL_LINE_PATTERN);
    if (match) {
      const key = match[1];
      if (OPTIONAL_VARIABLES.has(key)) {
        const value = key in variables ? variables[key] : "";
        if (value === "") {
          // Strip the entire line and collapse adjacent blank line
          if (result.length > 0 && result[result.length - 1].trim() === "") {
            result.pop();
          } else {
            skipNextBlank = true;
          }
          continue;
        }
        result.push(value);
        continue;
      }
    }

    if (skipNextBlank && line.trim() === "") {
      skipNextBlank = false;
      continue;
    }
    skipNextBlank = false;

    // Standard variable replacement for all other lines
    const resolved = line.replace(/\{\{([\w-]+)\}\}/g, (m, key: string) => {
      if (OPTIONAL_VARIABLES.has(key)) {
        return key in variables ? variables[key] : "";
      }
      return key in variables ? variables[key] : m;
    });
    result.push(resolved);
  }

  return result.join("\n");
}
