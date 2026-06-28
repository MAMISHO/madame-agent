import { Injectable } from '@nestjs/common';

export interface ValidatorDefinition {
  ext: string;
  command: string;
}

@Injectable()
export class ValidatorService {
  /**
   * Parse the preparer report to dynamically load validators for the detected stack.
   */
  getValidatorsForEnvironment(preparerReport: string): ValidatorDefinition[] {
    const validators: ValidatorDefinition[] = [];
    const reportLower = (preparerReport || '').toLowerCase();

    // Check for TS/JS Ecosystem (NestJS, React, Node, etc.)
    const isTsJs =
      reportLower.includes('typescript') ||
      reportLower.includes('javascript') ||
      reportLower.includes('node') ||
      reportLower.includes('nestjs') ||
      reportLower.includes('package.json');

    // Check for Python Ecosystem
    const isPython =
      reportLower.includes('python') ||
      reportLower.includes('django') ||
      reportLower.includes('fastapi') ||
      reportLower.includes('requirements.txt') ||
      reportLower.includes('pyproject.toml');

    // Check for Go Ecosystem
    const isGo =
      reportLower.includes('golang') || reportLower.includes('go.mod');

    if (isTsJs) {
      const tsCommand =
        'npx prettier --write "{path}" && npx eslint "{path}" --fix && npx tsc --noEmit --skipLibCheck --jsx react-jsx "{path}"';
      validators.push({ ext: '.ts', command: tsCommand });
      validators.push({ ext: '.tsx', command: tsCommand });
      validators.push({
        ext: '.js',
        command: 'npx prettier --write "{path}" && npx eslint "{path}" --fix',
      });
      validators.push({
        ext: '.jsx',
        command: 'npx prettier --write "{path}" && npx eslint "{path}" --fix',
      });
      validators.push({ ext: '.json', command: 'npx prettier --write "{path}"' });
      validators.push({ ext: '.md', command: 'npx prettier --write "{path}"' });
    }

    if (isPython) {
      validators.push({
        ext: '.py',
        command: 'black "{path}" && ruff check "{path}" --fix',
      });
    }

    if (isGo) {
      validators.push({
        ext: '.go',
        command: 'gofmt -w "{path}" && golangci-lint run "{path}"',
      });
    }

    return validators;
  }

  /**
   * Return a global check command to run during the QA phase based on the stack.
   */
  getGlobalCheckCommand(preparerReport: string): string {
    const reportLower = (preparerReport || '').toLowerCase();

    // Check for TS/JS
    if (
      reportLower.includes('typescript') ||
      reportLower.includes('nestjs') ||
      reportLower.includes('package.json')
    ) {
      return 'npx eslint "{src,apps,libs,test,opencode-plugin}/**/*.{ts,tsx}" && npx tsc --noEmit --skipLibCheck --jsx react-jsx';
    }

    // Check for Python
    if (
      reportLower.includes('python') ||
      reportLower.includes('pyproject.toml')
    ) {
      return 'ruff check . && mypy .';
    }

    // Check for Go
    if (reportLower.includes('golang') || reportLower.includes('go.mod')) {
      return 'golangci-lint run ./... && go test ./...';
    }

    // Default fallback
    return 'echo "No global QA linter detected for this stack."';
  }
}
