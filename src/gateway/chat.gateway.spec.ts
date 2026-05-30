import { ChatGateway } from './chat.gateway';

describe('ChatGateway', () => {
  const createGateway = () =>
    new ChatGateway(
      {} as any,
      {
        getUsersSockets: jest.fn(),
      } as any,
      {
        joinConversationRoom: jest.fn(),
      } as any,
      {} as any,
      {
        findById: jest.fn(),
      } as any,
      {} as any,
      {} as any,
      {} as any,
      {
        emitEvent: jest.fn(),
      } as any,
    );

  it('does not reject when conversation notification fails', async () => {
    const gateway = createGateway();
    const loggerWarn = jest
      .spyOn((gateway as any).logger, 'warn')
      .mockImplementation(() => undefined);

    (gateway as any).conversationsService.findById.mockResolvedValue({ _id: 'conv-1' });
    (gateway as any).connectionService.getUsersSockets.mockRejectedValue(new Error('redis down'));

    await expect(gateway.notifyNewConversation('conv-1', ['user-1'])).resolves.toBeUndefined();
    expect(loggerWarn).toHaveBeenCalled();
  });
});
