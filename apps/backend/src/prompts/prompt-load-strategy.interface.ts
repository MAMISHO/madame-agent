export interface PromptLoadStrategy {
  loadPrompt(id: string, variables?: Record<string, string>, harnessId?: string): Promise<string>;
  loadPromptBySourceTarget(
    source: string,
    target: string,
    variables?: Record<string, string>,
    harnessId?: string
  ): Promise<string>;
}
