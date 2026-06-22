import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Message } from '../proxy/dto/openai.dto';

@Injectable()
export class TranslationService {
  private readonly logger = new Logger(TranslationService.name);
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly enabled: boolean;
  private readonly targetLang: string;

  constructor(private configService: ConfigService) {
    this.enabled = this.configService.get<boolean>('translation.enabled', false);
    this.model = this.configService.get<string>('translation.model', 'gemma4:12b-mlx');
    this.baseUrl = this.configService.get<string>('translation.baseUrl', 'http://localhost:11434');
    this.targetLang = this.configService.get<string>('translation.targetLang', 'en');
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async detectLanguage(text: string): Promise<string> {
    const prompt = `Identify the ISO 639-1 language code of this text. Respond with ONLY the two-letter code, nothing else.

Text: "${text.slice(0, 500)}"`;

    const response = await this.callOllama(prompt);
    const code = response.trim().toLowerCase().slice(0, 2);
    return code;
  }

  needsTranslation(text: string): boolean {
    if (!text || !this.enabled) return false;
    return true;
  }

  async translateTo(text: string, targetLang: string = this.targetLang): Promise<string> {
    const sourceLang = await this.detectLanguage(text);
    if (sourceLang === targetLang) return text;

    this.logger.debug(`Translating from ${sourceLang} → ${targetLang}: "${text.slice(0, 60)}..."`);

    const prompt = `Translate the following text from ${sourceLang} to ${targetLang}. Return ONLY the translation, no explanations, no quotes.

Text: "${text.slice(0, 2000)}"

Translation:`;

    const translated = await this.callOllama(prompt);
    return translated.trim();
  }

  async translateMessages(messages: Message[]): Promise<Message[]> {
    if (!this.enabled) return messages;

    const translated: Message[] = [];
    for (const msg of messages) {
      if (msg.role === 'user' && typeof msg.content === 'string') {
        const detected = await this.detectLanguage(msg.content);
        if (detected !== this.targetLang) {
          const translatedContent = await this.translateTo(msg.content);
          translated.push({ ...msg, content: translatedContent });
        } else {
          translated.push(msg);
        }
      } else {
        translated.push(msg);
      }
    }
    return translated;
  }

  private async callOllama(prompt: string): Promise<string> {
    const url = `${this.baseUrl.replace(/\/$/, '')}/api/generate`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        prompt,
        stream: false,
        options: { temperature: 0.1, max_tokens: 256 },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Ollama generate returned ${response.status}: ${errText}`);
    }

    const data = await response.json();
    return data.response || '';
  }
}
