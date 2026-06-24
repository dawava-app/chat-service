import { Module, forwardRef } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConversationsModule } from '../conversations/conversations.module';
import { UsersModule } from '../users/users.module';
import { GatewayModule } from '../gateway/gateway.module';
import { PresenceModule } from '../presence/presence.module';
import { WebhooksModule } from '../webhooks/webhooks.module';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { FileServiceClient } from './file-service.client';
import { Message, MessageSchema } from './schemas/message.schema';

@Module({
  imports: [
    forwardRef(() => ConversationsModule),
    UsersModule,
    forwardRef(() => GatewayModule),
    forwardRef(() => PresenceModule),
    WebhooksModule,
    MongooseModule.forFeature([{ name: Message.name, schema: MessageSchema }]),
  ],
  controllers: [MessagesController],
  providers: [MessagesService, FileServiceClient],
  exports: [MessagesService],
})
export class MessagesModule {}
