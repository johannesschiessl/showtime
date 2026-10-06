import { Context, Layer } from "effect";
import {
  nextMicrophoneNumber,
  type Microphone,
  type MicrophoneId,
  type MicrophoneNumber,
} from "@showtime/contracts";
import {
  makeNumberedResourceService,
  type NumberedResourceServiceShape,
} from "../numbered-resources/NumberedResourceService.js";

type MicrophoneServiceShape = NumberedResourceServiceShape<
  Microphone,
  MicrophoneId,
  MicrophoneNumber
>;

export class MicrophoneService extends Context.Service<MicrophoneService, MicrophoneServiceShape>()(
  "@showtime/backend/microphones/MicrophoneService",
) {}

const make = makeNumberedResourceService<Microphone, MicrophoneId, MicrophoneNumber>({
  resourceName: "microphone",
  getResources: (document) => document.microphones,
  withResources: (document, microphones) => ({ ...document, microphones }),
  makeId: (ids) => ids.makeMicrophoneId,
  nextNumber: nextMicrophoneNumber,
});

export const layer = Layer.effect(MicrophoneService, make);
