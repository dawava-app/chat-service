import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes, Types } from 'mongoose';
import { Attachment, AttachmentSchema } from './attachment.schema';

export type MessageDocument = HydratedDocument<Message>;

export enum MessageType {
  Text = 'text',
  System = 'system',
}

@Schema({ _id: false })
export class Reaction {
  @Prop({ required: true, maxlength: 20 })
  emoji!: string;

  @Prop({ type: [String], default: [] })
  userIds!: string[];
}

export const ReactionSchema = SchemaFactory.createForClass(Reaction);

@Schema({ _id: false })
export class ReadReceipt {
  @Prop({ required: true })
  userId!: string;

  @Prop({ required: true })
  readAt!: Date;
}

export const ReadReceiptSchema = SchemaFactory.createForClass(ReadReceipt);

@Schema({ timestamps: true })
export class Message {
  @Prop({ type: SchemaTypes.ObjectId, required: true, index: true })
  conversationId!: Types.ObjectId;

  @Prop({ required: true, index: true })
  senderId!: string;

  @Prop({ required: false })
  content?: string;

  @Prop({ enum: MessageType, default: MessageType.Text })
  type!: MessageType;

  @Prop({ type: [AttachmentSchema], default: [] })
  attachments!: Attachment[];

  @Prop({ type: SchemaTypes.ObjectId })
  replyTo?: Types.ObjectId;

  @Prop({ default: false })
  isEdited!: boolean;

  @Prop({ default: false })
  isDeleted!: boolean;

  @Prop()
  deletedAt?: Date;

  @Prop({ type: SchemaTypes.Mixed })
  metadata?: Record<string, unknown>;

  @Prop({ type: [ReactionSchema], default: [] })
  reactions!: Reaction[];

  @Prop({ type: [ReadReceiptSchema], default: [] })
  readBy!: ReadReceipt[];

  createdAt?: Date;
  updatedAt?: Date;
}

export const MessageSchema = SchemaFactory.createForClass(Message);

MessageSchema.index({ conversationId: 1, createdAt: -1 });
MessageSchema.index({ conversationId: 1, isDeleted: 1 });
MessageSchema.index({ conversationId: 1, senderId: 1, 'readBy.userId': 1, isDeleted: 1 });
