export { registerSttRoute } from "./route";
export {
  handleSttAction,
  handleSttAudioMessage,
  handleSttUnsupportedMessage,
  type HandleSttActionInput,
  type HandleSttAudioMessageInput,
  type HandleSttUnsupportedMessageInput,
} from "./handler";
export {
  classifyAudioMessage,
  composePromptFromTranscript,
  startSttRun,
  transcribeAudioAttachment,
  type AudioMessageClassification,
} from "./service";
export {
  createSttRunRegistry,
  type SttRun,
  type SttRunRegistry,
  type SttRunState,
} from "./run-registry";
export {
  SttAttachmentReadError,
  SttAttachmentTooLargeError,
  SttClientCreateError,
  SttResponseError,
  SttRunNotFoundError,
  SttRunNotReadyError,
  SttRunStateConflictError,
  SttTranscriptionError,
  SttUnsupportedAudioMessageError,
  type SttSendTranscriptError,
  type SttTranscribeError,
} from "./errors";
