import { DateTime, Effect } from "effect";
import { RpcError, type Color, type ShowId } from "@showtime/contracts";
import { Ids, type IdsShape } from "../ids/Ids.js";
import { ShowRepository, type ShowDocument } from "../shows/ShowRepository.js";

export interface NumberedResource<Id extends string, Number extends string> {
  readonly id: Id;
  readonly number: Number;
  readonly color: Color;
  readonly name?: string;
  readonly createdAt: DateTime.Utc;
  readonly updatedAt: DateTime.Utc;
  readonly deletedAt?: DateTime.Utc;
}

export interface NumberedResourceServiceShape<
  Resource extends NumberedResource<Id, Number>,
  Id extends string,
  Number extends string,
> {
  readonly list: (showId: ShowId) => Effect.Effect<ReadonlyArray<Resource>, RpcError>;
  readonly create: (params: {
    readonly showId: ShowId;
    readonly color: Color;
  }) => Effect.Effect<Resource, RpcError>;
  readonly edit: (params: {
    readonly showId: ShowId;
    readonly id: Id;
    readonly number: Number;
    readonly color: Color;
    readonly name?: string;
  }) => Effect.Effect<Resource, RpcError>;
  readonly delete: (params: {
    readonly showId: ShowId;
    readonly id: Id;
  }) => Effect.Effect<void, RpcError>;
}

interface NumberedResourceConfig<
  Resource extends NumberedResource<Id, Number>,
  Id extends string,
  Number extends string,
> {
  readonly resourceName: string;
  readonly getResources: (document: ShowDocument) => ReadonlyArray<Resource>;
  readonly withResources: (
    document: ShowDocument,
    resources: ReadonlyArray<Resource>,
  ) => ShowDocument;
  readonly makeId: (ids: IdsShape) => Effect.Effect<Id>;
  readonly nextNumber: (numbers: Iterable<string>) => Number;
  readonly deleteBlockedMessage?: (id: Id) => string | undefined;
}

const toRpcError = (message: string) => (cause: unknown) => new RpcError({ message, cause });

const removeName = <Resource extends { readonly name?: string }>(resource: Resource) => {
  const { name: _name, ...withoutName } = resource;
  return withoutName;
};

export const makeNumberedResourceService = Effect.fnUntraced(function* <
  Resource extends NumberedResource<Id, Number>,
  Id extends string,
  Number extends string,
>(config: NumberedResourceConfig<Resource, Id, Number>) {
  const ids = yield* Ids;
  const repository = yield* ShowRepository;
  const capitalizedName = `${config.resourceName[0]!.toUpperCase()}${config.resourceName.slice(1)}`;

  const list: NumberedResourceServiceShape<Resource, Id, Number>["list"] = Effect.fnUntraced(
    function* (showId) {
      return config
        .getResources(yield* repository.findById(showId))
        .filter((resource) => resource.deletedAt === undefined);
    },
  );

  const create: NumberedResourceServiceShape<Resource, Id, Number>["create"] = Effect.fnUntraced(
    function* ({ showId, color }) {
      const id = yield* config.makeId(ids);
      const now = yield* DateTime.now;
      const updated = yield* repository
        .update(showId, (document) => {
          const resources = config.getResources(document);
          const number = config.nextNumber(
            resources
              .filter((resource) => resource.deletedAt === undefined)
              .map((resource) => resource.number),
          );
          const resource = {
            id,
            number,
            color,
            createdAt: now,
            updatedAt: now,
          } as Resource;
          return config.withResources(document, [...resources, resource]);
        })
        .pipe(Effect.mapError(toRpcError(`Could not add ${config.resourceName}.`)));
      return config.getResources(updated).find((resource) => resource.id === id)!;
    },
  );

  const edit: NumberedResourceServiceShape<Resource, Id, Number>["edit"] = Effect.fnUntraced(
    function* (params) {
      const trimmedName = params.name?.trim();
      const now = yield* DateTime.now;
      const updated = yield* repository
        .update(params.showId, (document) => {
          const resources = config.getResources(document);
          const existing = resources.find(
            (resource) => resource.id === params.id && resource.deletedAt === undefined,
          );
          if (existing === undefined) return document;

          const existingForUpdate = params.name === undefined ? existing : removeName(existing);
          const resource = {
            ...existingForUpdate,
            number: params.number,
            color: params.color,
            updatedAt: now,
            ...(trimmedName ? { name: trimmedName } : {}),
          } as Resource;
          return config.withResources(
            document,
            resources.map((item) => (item.id === params.id ? resource : item)),
          );
        })
        .pipe(Effect.mapError(toRpcError(`Could not edit ${config.resourceName}.`)));
      const resource = config
        .getResources(updated)
        .find((item) => item.id === params.id && item.deletedAt === undefined);
      if (resource === undefined) {
        return yield* Effect.fail(new RpcError({ message: `${capitalizedName} not found.` }));
      }
      return resource;
    },
  );

  const deleteResource: NumberedResourceServiceShape<Resource, Id, Number>["delete"] =
    Effect.fnUntraced(function* (params) {
      const blockedMessage = config.deleteBlockedMessage?.(params.id);
      if (blockedMessage !== undefined) {
        return yield* Effect.fail(new RpcError({ message: blockedMessage }));
      }
      const found = yield* repository.findById(params.showId);
      if (
        !config
          .getResources(found)
          .some((resource) => resource.id === params.id && resource.deletedAt === undefined)
      ) {
        return yield* Effect.fail(new RpcError({ message: `${capitalizedName} not found.` }));
      }
      const now = yield* DateTime.now;
      yield* repository
        .update(params.showId, (document) =>
          config.withResources(
            document,
            config
              .getResources(document)
              .map((resource) =>
                resource.id === params.id
                  ? ({ ...resource, updatedAt: now, deletedAt: now } as Resource)
                  : resource,
              ),
          ),
        )
        .pipe(Effect.mapError(toRpcError(`Could not delete ${config.resourceName}.`)));
    });

  return { list, create, edit, delete: deleteResource } satisfies NumberedResourceServiceShape<
    Resource,
    Id,
    Number
  >;
});
