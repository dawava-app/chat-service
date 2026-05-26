import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Authorize } from '../auth/decorators/authorize.decorator';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { ConversationsService } from '../conversations/conversations.service';
import { GetBatchPresenceDto } from './dto/get-batch-presence.dto';
import { PresenceService } from './presence.service';

@ApiTags('presence')
@Controller('api')
@Authorize()
export class PresenceController {
  constructor(
    private readonly presenceService: PresenceService,
    private readonly conversationsService: ConversationsService,
  ) {}

  @Get('users/:userId/presence')
  @ApiOperation({ summary: 'Get presence for a user' })
  async getPresence(@Param('userId') userId: string) {
    return this.presenceService.getPresenceStatus(userId);
  }

  @Get('conversations/:conversationId/presence')
  @ApiOperation({ summary: 'Get presence for a conversation' })
  async getConversationPresence(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId') conversationId: string,
  ) {
    const conversation = await this.conversationsService.findByIdForUser(
      conversationId,
      user.externalUserId,
    );

    const participantIds = conversation.participants.map((p) => p.externalUserId);
    return this.presenceService.getConversationPresence(conversationId, participantIds);
  }

  @Post('presence/batch')
  @Authorize({ jwt: true, internal: true })
  @ApiOperation({ summary: 'Get presence for multiple users' })
  async getBatchPresence(@Body() dto: GetBatchPresenceDto) {
    const presences = await this.presenceService.getPresenceStatuses(dto.userIds);
    return { presences };
  }
}
