import { readFileSync } from 'fs';
import { join } from 'path';

export function loadPromptTemplate(filename: string, variables: Record<string, string> = {}): string {
  const filePath = join(process.cwd(), 'templates', 'prompts', filename);
  let content = readFileSync(filePath, 'utf8');
  for (const [key, value] of Object.entries(variables)) {
    content = content.replace(new RegExp(`{{${key}}}`, 'g'), value);
  }
  return content.trim();
}
