import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConversationsService } from './conversations.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { QueryConversationsDto } from './dto/query-conversations.dto';
import { AddParticipantDto } from './dto/add-participant.dto';
import { UpdateParticipantRoleDto } from './dto/update-participant-role.dto';
import { Authorize } from '../auth/decorators/authorize.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../common/interfaces/authenticated-user.interface';
import { UsersService } from '../users/users.service';
import { Conversation, ConversationType } from './schemas/conversation.schema';
import { ParticipantRole } from './schemas/participant.schema';

interface ConversationParticipantWithProfile {
  externalUserId: string;
  role?: ParticipantRole;
  joinedAt: Date;
  addedBy?: string;
  profile: {
    displayName?: string;
    avatarUrl?: string;
  } | null;
}

type ConversationWithProfiles = Omit<Conversation, 'participants'> & {
  participants: ConversationParticipantWithProfile[];
};

@ApiTags('conversations')
@ApiBearerAuth()
@Controller('api/conversations')
@Authorize()
export class ConversationsController {
  constructor(
    private readonly conversationsService: ConversationsService,
    private readonly usersService: UsersService,
  ) {}

  @Post()
  @Authorize({ jwt: true, internal: true })
  @ApiOperation({ summary: 'Create a conversation' })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateConversationDto,
  ): Promise<ConversationWithProfiles> {
    const conversation = await this.conversationsService.create(user.externalUserId, dto);
    return this.attachProfilesToConversation(conversation);
  }

  @Get()
  @ApiOperation({ summary: 'List conversations for current user' })
  async list(@CurrentUser() user: AuthenticatedUser, @Query() query: QueryConversationsDto) {
    const result = await this.conversationsService.findAllForUser(user.externalUserId, query);
    const data = await this.attachProfilesToConversations(result.data);

    return {
      data,
      pagination: result.pagination,
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a conversation by id' })
  async findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<ConversationWithProfiles> {
    const conversation = await this.conversationsService.findByIdForUser(id, user.externalUserId);
    return this.attachProfilesToConversation(conversation);
  }

  @Delete(':id')
  @Authorize({ jwt: true, internal: true })
  @ApiOperation({ summary: 'Leave or delete a conversation' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query('mode') mode?: 'leave' | 'delete',
  ): Promise<void> {
    if (mode === 'delete') {
      await this.conversationsService.delete(id, user.externalUserId);
      return;
    }

    const conversation = await this.conversationsService.findByIdForUser(id, user.externalUserId);

    if (mode === 'leave') {
      if (conversation.type === ConversationType.Direct) {
        throw new BadRequestException('Cannot leave direct conversations');
      }

      await this.conversationsService.leave(id, user.externalUserId);
      return;
    }

    if (conversation.type === ConversationType.Direct) {
      await this.conversationsService.delete(id, user.externalUserId);
      return;
    }

    await this.conversationsService.leave(id, user.externalUserId);
  }

  @Post(':id/participants')
  @Authorize({ jwt: true, internal: true })
  @ApiOperation({ summary: 'Add a participant to a conversation' })
  async addParticipant(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AddParticipantDto,
  ): Promise<ConversationWithProfiles> {
    const conversation = await this.conversationsService.addParticipant(
      id,
      user.externalUserId,
      dto,
    );
    return this.attachProfilesToConversation(conversation);
  }

  @Patch(':id/participants/:userId')
  @Authorize({ jwt: true, internal: true })
  @ApiOperation({ summary: 'Update a participant role' })
  async updateParticipantRole(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
    @Body() dto: UpdateParticipantRoleDto,
  ): Promise<ConversationWithProfiles> {
    const conversation = await this.conversationsService.updateParticipantRole(
      id,
      user.externalUserId,
      targetUserId,
      dto,
    );
    return this.attachProfilesToConversation(conversation);
  }

  @Delete(':id/participants/:userId')
  @Authorize({ jwt: true, internal: true })
  @ApiOperation({ summary: 'Remove a participant from a conversation' })
  async removeParticipant(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
  ): Promise<ConversationWithProfiles> {
    const conversation = await this.conversationsService.removeParticipant(
      id,
      user.externalUserId,
      targetUserId,
    );
    return this.attachProfilesToConversation(conversation);
  }

  private async attachProfilesToConversations(
    conversations: Conversation[],
  ): Promise<ConversationWithProfiles[]> {
    if (!conversations.length) {
      return [];
    }

    const ids = new Set<string>();
    conversations.forEach((conversation) => {
      const plain = this.toPlainConversation(conversation);
      plain.participants?.forEach((participant) => ids.add(participant.externalUserId));
    });

    const profiles = await this.usersService.findManyByExternalIds([...ids]);
    const profileMap = new Map(profiles.map((profile) => [profile.externalUserId, profile]));

    return conversations.map((conversation) => this.attachProfiles(conversation, profileMap));
  }

  private async attachProfilesToConversation(
    conversation: Conversation,
  ): Promise<ConversationWithProfiles> {
    const plain = this.toPlainConversation(conversation);
    const ids = plain.participants.map((participant) => participant.externalUserId);
    const profiles = await this.usersService.findManyByExternalIds(ids);
    const profileMap = new Map(profiles.map((profile) => [profile.externalUserId, profile]));

    return this.attachProfiles(conversation, profileMap);
  }

  private attachProfiles(
    conversation: Conversation,
    profileMap: Map<string, { displayName?: string; avatarUrl?: string }>,
  ): ConversationWithProfiles {
    const plain = this.toPlainConversation(conversation);

    const participants = plain.participants.map((participant) => {
      const profile = profileMap.get(participant.externalUserId);
      return {
        ...participant,
        profile: profile
          ? {
              displayName: profile.displayName,
              avatarUrl: profile.avatarUrl,
            }
          : null,
      };
    });

    return {
      ...plain,
      participants,
      metadata: plain.metadata ?? {},
    } as ConversationWithProfiles;
  }

  private toPlainConversation(conversation: Conversation): Conversation {
    if (typeof (conversation as any).toObject === 'function') {
      return (conversation as any).toObject({ getters: true, virtuals: false });
    }
    return conversation;
  }
}
