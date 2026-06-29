import { Injectable, BadRequestException } from '@nestjs/common';

@Injectable()
export class RepositoryValidator {
  /**
   * Validates a code string.
   * A valid code must:
   * - Be at least 8 characters long
   * - Contain only alphanumeric characters and hyphens/underscores
   * - Not contain spaces or special characters like @, #, $, etc.
   * 
   * @param code The string to validate
   * @throws BadRequestException if the code is invalid
   */
  validateCode(code: string): void {
    if (!code) {
      throw new BadRequestException('Code cannot be empty');
    }

    if (code.length < 8) {
      throw new BadRequestException('Code must be at least 8 characters long');
    }

    if (code.length > 50) {
        throw new BadRequestException('Code cannot exceed 50 characters');
    }

    // Only alphanumeric, hyphens, and underscores. No spaces or other special chars.
    const codeRegex = /^[a-zA-Z0-9-_]+$/;
    if (!codeRegex.test(code)) {
      throw new BadRequestException(
        'Code can only contain alphanumeric characters, hyphens, and underscores (no spaces or special characters)'
      );
    }
  }
}
