import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Authorize } from '../auth/decorators/authorize.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { ConversationsService } from '../conversations/conversations.service';
import { EditMessageDto } from './dto/edit-message.dto';
import { QueryMessagesDto } from './dto/query-messages.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { MessagesService, MessageWithSender, MessageWithSenderAndReply } from './messages.service';

@ApiTags('messages')
@ApiBearerAuth()
@Controller('api')
@Authorize()
export class MessagesController {
  constructor(
    private readonly messagesService: MessagesService,
    private readonly conversationsService: ConversationsService,
  ) {}

  @Post('conversations/:conversationId/messages')
  @ApiOperation({ summary: 'Send a message' })
  async send(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId') conversationId: string,
    @Body() dto: SendMessageDto,
  ): Promise<MessageWithSender | MessageWithSenderAndReply> {

    if (user.externalUserId !== user.claims.sub) {
      dto.metadata = {
        ...dto.metadata,
        originalSenderId: user.claims.sub,
      };
    }

    const message = await this.messagesService.send(conversationId, user.externalUserId, dto);

    if (dto.replyTo) {
      return this.messagesService.populateReplyPreview(message);
    }

    return message;
  }

  @Get('conversations/:conversationId/messages')
  @ApiOperation({ summary: 'List messages in a conversation' })
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('conversationId') conversationId: string,
    @Query() query: QueryMessagesDto,
  ) {
    await this.conversationsService.findByIdForUser(conversationId, user.externalUserId);
    return this.messagesService.findByConversation(conversationId, query, user.externalUserId);
  }

  @Get('messages/:id')
  @ApiOperation({ summary: 'Get a message by id' })
  async findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<MessageWithSenderAndReply> {
    const message = await this.messagesService.findById(id);
    if (!message) {
      throw new NotFoundException('Message not found');
    }

    await this.conversationsService.findByIdForUser(
      message.conversationId.toString(),
      user.externalUserId,
    );

    const populated = await this.messagesService.populateMessageWithSender(
      message,
      user.externalUserId,
    );
    return this.messagesService.populateReplyPreview(populated);
  }

  @Patch('messages/:id')
  @ApiOperation({ summary: 'Edit a message' })
  async edit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: EditMessageDto,
  ): Promise<MessageWithSender> {
    return this.messagesService.edit(id, user.externalUserId, dto);
  }

  @Delete('messages/:id')
  @ApiOperation({ summary: 'Delete a message' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<{ deleted: true }> {
    return this.messagesService.delete(id, user.externalUserId);
  }
}
