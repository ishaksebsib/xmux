import Emittery from "emittery";

export type ChannelHandle = {
  adapterId: string;
  channelId: string;
};

export type XmuxEventMap = {
  "adapter:ready": { adapterId: string };
  "command:received": { source: ChannelHandle; command: string; args: string[] };
  "session:created": { sessionId: string; harnessId: string; source: ChannelHandle };
};

export type XmuxBus = Emittery<XmuxEventMap>;

export function createBus(): XmuxBus {
  return new Emittery<XmuxEventMap>();
}
