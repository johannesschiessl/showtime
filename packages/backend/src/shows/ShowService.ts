import { Context, DateTime, Effect, Layer } from "effect";
import {
  decodeShowName,
  mainMixId,
  MixId,
  MixNumber,
  sortShowSummaries,
  RpcError,
  type Color,
  type ShowId,
  type ShowSummary,
} from "@showtime/contracts";
import { Ids } from "../ids/Ids.js";
import { ShowRepository, type ShowDocument } from "./ShowRepository.js";

export class ShowService extends Context.Service<
  ShowService,
  {
    readonly list: Effect.Effect<ReadonlyArray<ShowSummary>, RpcError>;
    readonly create: (params: {
      readonly name: string;
      readonly color: Color;
    }) => Effect.Effect<ShowSummary, RpcError>;
    readonly edit: (params: {
      readonly id: ShowId;
      readonly name: string;
      readonly color: Color;
    }) => Effect.Effect<ShowSummary, RpcError>;
    readonly delete: (id: ShowId) => Effect.Effect<void, RpcError>;
  }
>()("@showtime/backend/shows/ShowService") {}

const toRpcError = (message: string) => (cause: unknown) =>
  new RpcError({
    message,
    cause,
  });

const toSummary = (document: ShowDocument): ShowSummary => ({
  id: document.config.id,
  name: document.config.name,
  color: document.config.color,
  createdAt: DateTime.formatIso(document.config.createdAt),
  updatedAt: DateTime.formatIso(document.config.updatedAt),
});

const makeShowService = Effect.fnUntraced(function* () {
  const ids = yield* Ids;
  const repository = yield* ShowRepository;

  const list = repository.summaries.pipe(
    Effect.map(sortShowSummaries),
    Effect.mapError(toRpcError("Could not list shows.")),
  );

  const create = Effect.fnUntraced(function* ({
    name,
    color,
  }: {
    readonly name: string;
    readonly color: Color;
  }) {
    const id = yield* ids.makeShowId;
    const showName = yield* decodeShowName(name).pipe(
      Effect.mapError(toRpcError("Show name cannot be empty.")),
    );
    const now = yield* DateTime.now;
    const document: ShowDocument = {
      config: { id, name: showName, color, createdAt: now, updatedAt: now },
      microphones: [],
      mixes: [
        {
          id: MixId.make(mainMixId),
          number: MixNumber.make("LR"),
          color: "sky",
          name: "Main",
          createdAt: now,
          updatedAt: now,
        },
      ],
      songs: [],
    };
    yield* repository.insert(document);

    return toSummary(document);
  });

  const edit = Effect.fnUntraced(function* ({
    id,
    name,
    color,
  }: {
    readonly id: ShowId;
    readonly name: string;
    readonly color: Color;
  }) {
    const showName = yield* decodeShowName(name).pipe(
      Effect.mapError(toRpcError("Show name cannot be empty.")),
    );
    const document = yield* repository
      .update(id, (current) => ({
        ...current,
        config: {
          ...current.config,
          name: showName,
          color,
        },
      }))
      .pipe(Effect.mapError(toRpcError("Could not edit show.")));

    return toSummary(document);
  });

  const deleteShow = Effect.fnUntraced(function* (id: ShowId) {
    yield* repository.delete(id);
  });

  return ShowService.of({
    list,
    create,
    edit,
    delete: deleteShow,
  });
});

export const layer = Layer.effect(ShowService, makeShowService());
