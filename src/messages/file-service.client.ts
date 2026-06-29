import {
  Injectable,
  Logger,
  InternalServerErrorException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class FileServiceClient {
  private readonly logger = new Logger(FileServiceClient.name);
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(private readonly configService: ConfigService) {
    this.baseUrl = this.configService.get<string>('fileService.url') || '';
    this.token = this.configService.get<string>('fileService.token') || '';
  }

  async commitFile(fileId: string): Promise<void> {
    if (!this.baseUrl || !this.token) {
      throw new InternalServerErrorException('File service is not configured.');
    }

    try {
      const url = `${this.baseUrl}/v1/uploads/sessions/${fileId}/commit`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-service-token': this.token,
        },
        body: JSON.stringify({ isPrivate: false }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        this.logger.error(`Failed to commit file ${fileId}: ${response.status} ${errorText}`);
        throw new BadRequestException(`Failed to commit attachment ${fileId}`);
      }
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      const message = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Error connecting to file service to commit file ${fileId}: ${message}`);
      throw new InternalServerErrorException(`File service communication failure: ${message}`);
    }
  }

  async commitFiles(fileIds: string[]): Promise<void> {
    await Promise.all(fileIds.map((id) => this.commitFile(id)));
  }
}
