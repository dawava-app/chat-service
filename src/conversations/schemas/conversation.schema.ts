import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, SchemaTypes } from 'mongoose';
import { Participant, ParticipantSchema } from './participant.schema';

export type ConversationDocument = HydratedDocument<Conversation>;

export enum ConversationType {
  Direct = 'direct',
  Group = 'group',
}

@Schema({ _id: false })
export class LastMessage {
  @Prop({ required: true })
  messageId!: string;

  @Prop({ required: true, maxlength: 200 })
  content!: string;

  @Prop({ required: true })
  senderId!: string;

  @Prop({ required: true })
  sentAt!: Date;
}

const LastMessageSchema = SchemaFactory.createForClass(LastMessage);

@Schema({ timestamps: true })
export class Conversation {
  @Prop({ required: true, enum: ConversationType })
  type!: ConversationType;

  @Prop()
  name?: string;

  @Prop()
  directKey?: string;

  @Prop({ type: [ParticipantSchema], required: true })
  participants!: Participant[];

  @Prop({ type: [String], required: true })
  participantIds!: string[];

  @Prop({ type: SchemaTypes.Mixed })
  metadata?: Record<string, unknown>;

  @Prop({ required: true })
  createdBy!: string;

  @Prop({ type: LastMessageSchema })
  lastMessage?: LastMessage;

  createdAt?: Date;
  updatedAt?: Date;
}

export const ConversationSchema = SchemaFactory.createForClass(Conversation);

ConversationSchema.index({ 'participants.externalUserId': 1 });
ConversationSchema.index({ updatedAt: -1 });
ConversationSchema.index(
  { directKey: 1 },
  { unique: true, partialFilterExpression: { type: ConversationType.Direct, directKey: { $exists: true } } },
);
