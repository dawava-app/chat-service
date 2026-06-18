export interface SocketUserData {
  externalUserId: string;
  conversationIds: string[];
  connectedAt: Date;
  claims: Record<string, any>;
}
