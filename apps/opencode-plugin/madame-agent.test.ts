import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as net from 'net'
import * as fs from 'fs'
import { isPortAvailable, isBackendHealthy, findExistingServer } from './madame-agent'

// Mock net
vi.mock('net', () => ({
  createServer: vi.fn(() => ({
    once: vi.fn(),
    listen: vi.fn(),
    close: vi.fn()
  }))
}))

// Mock fs
vi.mock('fs', async () => {
  const actual = await vi.importActual('fs')
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn()
  }
})

// Mock global fetch
global.fetch = vi.fn()

describe('madame-agent startup utils', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('isPortAvailable', () => {
    it('should return true if server listens successfully', async () => {
      const mockServer = {
        once: vi.fn((event, cb) => {
          if (event === 'listening') setTimeout(cb, 10)
        }),
        listen: vi.fn(),
        close: vi.fn()
      }
      vi.mocked(net.createServer).mockReturnValue(mockServer as any)

      const result = await isPortAvailable(3001)
      expect(result).toBe(true)
      expect(mockServer.listen).toHaveBeenCalledWith(3001, '127.0.0.1')
    })

    it('should return false if server fails to listen', async () => {
      const mockServer = {
        once: vi.fn((event, cb) => {
          if (event === 'error') setTimeout(cb, 10)
        }),
        listen: vi.fn(),
        close: vi.fn()
      }
      vi.mocked(net.createServer).mockReturnValue(mockServer as any)

      const result = await isPortAvailable(3001)
      expect(result).toBe(false)
    })
  })

  describe('isBackendHealthy', () => {
    it('should return true if health check succeeds', async () => {
      vi.mocked(fetch).mockResolvedValue({ ok: true } as any)
      const result = await isBackendHealthy(3001)
      expect(result).toBe(true)
      expect(fetch).toHaveBeenCalledWith('http://localhost:3001/v1/health', expect.anything())
    })

    it('should return false if health check fails', async () => {
      vi.mocked(fetch).mockResolvedValue({ ok: false } as any)
      const result = await isBackendHealthy(3001)
      expect(result).toBe(false)
    })

    it('should return false if fetch throws', async () => {
      vi.mocked(fetch).mockRejectedValue(new Error('fail'))
      const result = await isBackendHealthy(3001)
      expect(result).toBe(false)
    })
  })

  describe('findExistingServer', () => {
    it('should return null if port file does not exist', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false)
      const result = await findExistingServer('path/to/port')
      expect(result).toBeNull()
    })

    it('should return null if port in file is invalid', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue('invalid')
      const result = await findExistingServer('path/to/port')
      expect(result).toBeNull()
    })

    it('should return port if healthy', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue('3001')
      vi.mocked(fetch).mockResolvedValue({ ok: true } as any)

      const result = await findExistingServer('path/to/port')
      expect(result).toBe(3001)
      expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:3001/health?source=plugin', expect.anything())
    })
    
    it('should return null if process is unhealthy', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(true)
      vi.mocked(fs.readFileSync).mockReturnValue('3001')
      vi.mocked(fetch).mockResolvedValue({ ok: false } as any)
      
      const result = await findExistingServer('path/to/port')
      expect(result).toBeNull()
    })
  })
})
