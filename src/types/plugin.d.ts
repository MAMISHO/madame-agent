/**
 * Metadata information for a plugin.
 */
export interface PluginMetadata {
  name: string;
  version?: string;
  description?: string;
}

/**
 * A collection of hooks provided by the plugin.
 * Each key represents a hook name, and its value is a function 
 * that can be executed during the lifecycle.
 */
export interface PluginHooks {
  [hookName: string]: (...args: any[]) => void | Promise<any>;
}

/**
 * The main Plugin interface grouping metadata and hooks.
 */
export interface Plugin {
  metadata: PluginMetadata;
  hooks: PluginHooks;
}
