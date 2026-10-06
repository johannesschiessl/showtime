import { Context, Layer } from "effect";
import {
  mainMixId,
  nextMixNumber,
  type Mix,
  type MixId,
  type MixNumber,
} from "@showtime/contracts";
import {
  makeNumberedResourceService,
  type NumberedResourceServiceShape,
} from "../numbered-resources/NumberedResourceService.js";

type MixServiceShape = NumberedResourceServiceShape<Mix, MixId, MixNumber>;

export class MixService extends Context.Service<MixService, MixServiceShape>()(
  "@showtime/backend/mixes/MixService",
) {}

const make = makeNumberedResourceService<Mix, MixId, MixNumber>({
  resourceName: "mix",
  getResources: (document) => document.mixes,
  withResources: (document, mixes) => ({ ...document, mixes }),
  makeId: (ids) => ids.makeMixId,
  nextNumber: nextMixNumber,
  deleteBlockedMessage: (id) => (id === mainMixId ? "The main mix cannot be deleted." : undefined),
});

export const layer = Layer.effect(MixService, make);
