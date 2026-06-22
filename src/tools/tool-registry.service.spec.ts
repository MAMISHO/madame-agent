import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ToolRegistryService } from './tool-registry.service';

describe('ToolRegistryService', () => {
  let service: ToolRegistryService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ToolRegistryService,
        {
          provide: ConfigService,
          useValue: { get: jest.fn(() => undefined) },
        },
      ],
    }).compile();

    service = module.get<ToolRegistryService>(ToolRegistryService);
  });

  it('registers and retrieves a tool', () => {
    const handler = {
      definition: {
        type: 'function' as const,
        function: { name: 'test_tool', description: 'A test tool', parameters: { type: 'object', properties: {} } },
      },
      execute: async () => 'ok',
    };

    service.register(handler);
    expect(service.get('test_tool')).toBe(handler);
    expect(service.has('test_tool')).toBe(true);
  });

  it('getDefinitions returns all registered tool definitions', () => {
    service.register({
      definition: {
        type: 'function',
        function: { name: 'tool_a', description: 'Tool A', parameters: { type: 'object', properties: {} } },
      },
      execute: async () => 'a',
    });
    service.register({
      definition: {
        type: 'function',
        function: { name: 'tool_b', description: 'Tool B', parameters: { type: 'object', properties: {} } },
      },
      execute: async () => 'b',
    });

    const defs = service.getDefinitions();
    expect(defs).toHaveLength(2);
    expect(defs.map((d) => d.function.name)).toEqual(['tool_a', 'tool_b']);
  });

  it('list returns all registered tool names', () => {
    service.register({
      definition: {
        type: 'function',
        function: { name: 'tool_a', description: '', parameters: { type: 'object', properties: {} } },
      },
      execute: async () => 'a',
    });
    expect(service.list()).toEqual(['tool_a']);
  });

  it('returns undefined for unregistered tool', () => {
    expect(service.get('nonexistent')).toBeUndefined();
    expect(service.has('nonexistent')).toBe(false);
  });
});
