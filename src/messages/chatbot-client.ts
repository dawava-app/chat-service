import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface ChatbotMessage {
  role: 'human' | 'ai';
  content: string;
}

export interface ChatbotRequest {
  user_id: string;
  session_id: string;
  messages: ChatbotMessage[];
}

export interface ChatbotResponse {
  answer: string;
}

@Injectable()
export class ChatbotClient {
  private readonly logger = new Logger(ChatbotClient.name);
  private readonly baseUrl: string;

  constructor(private readonly configService: ConfigService) {
    this.baseUrl = this.configService.get<string>('chatbot.url') ?? '';
  }

  /**
   * Sends the full conversation history to the chatbot service and returns
   * the AI-generated answer.
   *
   * Returns `null` when the service is unreachable or returns an error so the
   * caller can handle failures silently.
   */
  async chat(payload: ChatbotRequest): Promise<ChatbotResponse | null> {
    if (!this.baseUrl) {
      this.logger.warn('ChatbotClient: CHATBOT_SERVICE_URL is not configured, skipping bot call');
      return null;
    }

    try {
      const url = `${this.baseUrl}/chat`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        this.logger.error(
          `ChatbotClient: request failed status=${response.status} body=${body}`,
        );
        return null;
      }

      return (await response.json()) as ChatbotResponse;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`ChatbotClient: network error – ${message}`);
      return null;
    }
  }
}
