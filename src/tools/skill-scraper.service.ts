import { Injectable, Logger } from '@nestjs/common';
import { McpClientService } from '../utils/mcp-client.service';

@Injectable()
export class SkillScraperService {
  private readonly logger = new Logger(SkillScraperService.name);

  constructor(private mcpClient: McpClientService) {}

  async scrapeSkill(query: string): Promise<{ name: string; content: string } | null> {
    this.logger.log(`Starting dynamic skill scraping for query: "${query}"`);

    // Priority 1: skillsmp.com
    try {
      const result = await this.scrapeSkillsMp(query);
      if (result) {
        this.logger.log(`Successfully scraped skill from skillsmp.com: "${result.name}"`);
        return result;
      }
    } catch (error: any) {
      this.logger.warn(`Failed to scrape skillsmp.com: ${error.message}`);
    }

    // Priority 2: findskill.ai
    try {
      const result = await this.scrapeFindSkill(query);
      if (result) {
        this.logger.log(`Successfully scraped skill from findskill.ai: "${result.name}"`);
        return result;
      }
    } catch (error: any) {
      this.logger.warn(`Failed to scrape findskill.ai: ${error.message}`);
    }

    this.logger.warn(`No skill found for query "${query}" on external catalogs.`);
    return null;
  }

  private async scrapeSkillsMp(query: string): Promise<{ name: string; content: string } | null> {
    this.logger.log(`Navigating to skillsmp.com for query "${query}"`);
    await this.mcpClient.callTool('browser_navigate', { url: 'https://skillsmp.com', wait_until: 'domcontentloaded' });
    await this.mcpClient.callTool('browser_wait_for', { timeout_ms: 2000 });

    // Use browser_evaluate to find search box, type, and press enter
    const searchExecuted = await this.mcpClient.callTool('browser_evaluate', {
      script: `(() => {
        const input = document.querySelector('input[type="search"]') || 
                      document.querySelector('input[type="text"]') || 
                      document.querySelector('input[name="search"]') ||
                      document.querySelector('input[placeholder*="search" i]') ||
                      document.querySelector('input[placeholder*="buscar" i]');
        if (!input) return false;
        input.value = "${query}";
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        
        // Try submitting the parent form
        if (input.form) {
          input.form.submit();
          return true;
        }
        
        // Or find button and click
        const btn = document.querySelector('button[type="submit"]') || 
                    document.querySelector('input[type="submit"]') ||
                    document.querySelector('.search-submit');
        if (btn) {
          btn.click();
          return true;
        }
        
        // Or press enter
        const keyEvent = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true });
        input.dispatchEvent(keyEvent);
        return true;
      })()`,
    });

    if (!searchExecuted) {
      this.logger.warn('Could not find search input on skillsmp.com');
      return null;
    }

    await this.mcpClient.callTool('browser_wait_for', { timeout_ms: 3000 });

    // Look for search results and click first item
    const clickedFirstResult = await this.mcpClient.callTool('browser_evaluate', {
      script: `(() => {
        // Find links that look like skill or blog post links
        const links = Array.from(document.querySelectorAll('a'));
        // Find links that are likely search results (not header/footer/menu links)
        const contentLinks = links.filter(a => {
          const href = a.href || '';
          const text = (a.innerText || '').toLowerCase();
          const parent = a.parentElement;
          return href.includes('/skills/') || href.includes('/skill/') || 
                 (parent && (parent.tagName === 'H2' || parent.tagName === 'H3' || parent.classList.contains('entry-title') || parent.classList.contains('post-title')));
        });
        
        if (contentLinks.length > 0) {
          contentLinks[0].click();
          return true;
        }
        return false;
      })()`,
    });

    if (!clickedFirstResult) {
      this.logger.warn('No search results found on skillsmp.com');
      return null;
    }

    await this.mcpClient.callTool('browser_wait_for', { timeout_ms: 2000 });

    // Extract title and text content
    const skillData = await this.mcpClient.callTool('browser_evaluate', {
      script: `(() => {
        const titleEl = document.querySelector('h1') || document.querySelector('.entry-title') || document.querySelector('.post-title');
        const title = titleEl ? titleEl.innerText.trim() : '';
        const bodyEl = document.querySelector('article') || document.querySelector('.entry-content') || document.querySelector('.post-content') || document.body;
        const content = bodyEl ? bodyEl.innerText.trim() : '';
        return { name: title, content: content };
      })()`,
    });

    if (skillData && skillData.name && skillData.content.length > 100) {
      return skillData;
    }
    return null;
  }

  private async scrapeFindSkill(query: string): Promise<{ name: string; content: string } | null> {
    this.logger.log(`Navigating to findskill.ai for query "${query}"`);
    await this.mcpClient.callTool('browser_navigate', { url: 'https://findskill.ai/es/skills/', wait_until: 'domcontentloaded' });
    await this.mcpClient.callTool('browser_wait_for', { timeout_ms: 2000 });

    // Fill the search box
    const searchExecuted = await this.mcpClient.callTool('browser_evaluate', {
      script: `(() => {
        const inputs = Array.from(document.querySelectorAll('input'));
        const input = inputs.find(i => {
          const placeholder = (i.getAttribute('placeholder') || '').toLowerCase();
          return placeholder.includes('buscar') || placeholder.includes('search') || placeholder.includes('skill');
        }) || inputs[0];
        
        if (!input) return false;
        input.value = "${query}";
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        
        // Find search/submit button or press Enter
        const btn = document.querySelector('button[type="submit"]') || 
                    document.querySelector('.search-btn') || 
                    document.querySelector('button');
        if (btn) {
          btn.click();
          return true;
        }
        
        const keyEvent = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true });
        input.dispatchEvent(keyEvent);
        return true;
      })()`,
    });

    if (!searchExecuted) {
      this.logger.warn('Could not find search input on findskill.ai');
      return null;
    }

    await this.mcpClient.callTool('browser_wait_for', { timeout_ms: 3000 });

    // Find all results, filter out Pro ones
    const clickedItem = await this.mcpClient.callTool('browser_evaluate', {
      script: `(() => {
        // Look for cards, items or links that contain skill names
        // Usually, skill listings have grid items or list elements. Let's inspect card containers
        const items = Array.from(document.querySelectorAll('a, .skill-card, .card, .item'));
        
        // Filter elements that look like a skill link and DO NOT contain "pro" label
        const nonProLinks = items.filter(el => {
          const text = (el.innerText || '').toLowerCase();
          const href = (el as any).href || '';
          
          // Must have text, must be clickable, must not have "pro" text badge
          const isPro = text.includes('pro') || 
                        el.querySelector('.pro') || 
                        el.querySelector('.badge-pro') ||
                        el.querySelector('[class*="pro" i]');
                        
          // Usually skills have links to their detail pages
          const isSkillLink = href.includes('/skills/') || href.includes('/skill/') || text.length > 5;
          return isSkillLink && !isPro;
        });

        if (nonProLinks.length > 0) {
          // Click the first non-pro result
          const link = nonProLinks[0] as HTMLElement;
          link.click();
          return true;
        }
        return false;
      })()`,
    });

    if (!clickedItem) {
      this.logger.warn('No non-Pro skills found matching query on findskill.ai');
      return null;
    }

    await this.mcpClient.callTool('browser_wait_for', { timeout_ms: 2000 });

    // Extract title and text content
    const skillData = await this.mcpClient.callTool('browser_evaluate', {
      script: `(() => {
        const titleEl = document.querySelector('h1') || document.querySelector('.skill-title') || document.querySelector('.title');
        const title = titleEl ? titleEl.innerText.trim() : '';
        const bodyEl = document.querySelector('article') || document.querySelector('.skill-detail') || document.querySelector('.content') || document.body;
        const content = bodyEl ? bodyEl.innerText.trim() : '';
        return { name: title, content: content };
      })()`,
    });

    if (skillData && skillData.name && skillData.content.length > 100) {
      return skillData;
    }
    return null;
  }
}
