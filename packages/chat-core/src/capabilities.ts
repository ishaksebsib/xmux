import type { ChatAttachmentKind } from "./contracts";

/** Runtime feature map used for safe facade decisions. */
export interface ChatAdapterCapabilities {
  readonly commands?: {
    readonly registration: "dynamic" | "manual" | "none";
    readonly options: boolean;
    readonly choices: boolean;
    readonly autocomplete: boolean;
  };
  readonly messages: {
    readonly send: true;
    readonly reply: boolean;
    readonly edit: boolean;
    readonly delete: boolean;
    readonly typing: boolean;
    readonly markdown: boolean;
    readonly attachments: {
      readonly receive: boolean;
      readonly send: boolean;
      readonly download: boolean;
      readonly kinds?: readonly ChatAttachmentKind[];
    };
    readonly stream?: {
      readonly send: boolean;
      readonly reply: boolean;
      readonly strategy: "native" | "edit" | "chunked";
    };
  };
  readonly reactions?: {
    readonly receive: boolean;
    readonly send: boolean;
  };
  readonly actions?: {
    readonly send: boolean;
    readonly receive: boolean;
    readonly ack: boolean;
    readonly reply: boolean;
    readonly update: boolean;
    readonly urlButtons: boolean;
    readonly maxButtonsPerMessage?: number;
    readonly maxButtonsPerRow?: number;
  };
}
