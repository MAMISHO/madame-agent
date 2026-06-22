import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SandboxManagerService, SandboxViolationError } from './sandbox-manager.service';

describe('SandboxManagerService', () => {
  let service: SandboxManagerService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SandboxManagerService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'tools.sandbox') {
                return {
                  workspace: '/test/workspace',
                  denied_commands: ['rm', 'sudo', 'curl', 'wget'],
                  max_timeout_ms: 30000,
                  allow_network: false,
                };
              }
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    service = module.get<SandboxManagerService>(SandboxManagerService);
  });

  it('allows paths within workspace', () => {
    expect(() =>
      service.check('read_file', { path: '/test/workspace/src/file.ts' }),
    ).not.toThrow();
  });

  it('rejects paths outside workspace', () => {
    expect(() =>
      service.check('read_file', { path: '/etc/passwd' }),
    ).toThrow(SandboxViolationError);
  });

  it('allows source and dest within workspace', () => {
    expect(() =>
      service.check('move_file', {
        source: '/test/workspace/a.ts',
        dest: '/test/workspace/b.ts',
      }),
    ).not.toThrow();
  });

  it('rejects source outside workspace', () => {
    expect(() =>
      service.check('move_file', {
        source: '/etc/hosts',
        dest: '/test/workspace/hosts',
      }),
    ).toThrow(SandboxViolationError);
  });

  it('rejects denied commands', () => {
    expect(() =>
      service.check('execute_command', { command: 'sudo rm -rf /' }),
    ).toThrow(SandboxViolationError);
  });

  it('allows allowed commands', () => {
    expect(() =>
      service.check('execute_command', { command: 'ls -la' }),
    ).not.toThrow();
  });

  it('rejects timeout exceeding maximum', () => {
    expect(() =>
      service.check('execute_command', {
        command: 'sleep',
        timeout: 60000,
      }),
    ).toThrow(SandboxViolationError);
  });

  it('rejects network URLs when allow_network is false', () => {
    expect(() =>
      service.check('write_file', { path: '/test/workspace/f', url: 'http://evil.com' }),
    ).toThrow(SandboxViolationError);
  });

  it('rejects glob patterns with ".."', () => {
    expect(() =>
      service.check('glob_files', { pattern: '../../etc/**/*' }),
    ).toThrow(SandboxViolationError);
  });
});
