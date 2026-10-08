import * as React from "react";
import { useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";
import {
  resolveChatPresetTemplate,
  type ChatMessagePart,
  type ChatPresetAnswer,
  type ChatPresetField,
  type Microphone,
  type Mix,
  type ShowId,
} from "@showtime/contracts";
import { microphoneAtoms, mixAtoms } from "@/client";
import { colorPreviewClassNames } from "@/components/color";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type TemplateDefinition = Pick<ChatPresetAnswer, "template" | "fields" | "context">;

export const chatPresetOptionsUseButtons = (options: ReadonlyArray<string>) => options.length < 5;

export const readableChatPresetFieldName = (name: string) =>
  name.replace(/[-_]+/g, " ").replace(/^./, (letter: string) => letter.toUpperCase());

function ChannelIdentity({
  channel,
}: {
  readonly channel: Pick<Microphone, "color" | "number"> | Pick<Mix, "color" | "number">;
}) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        aria-hidden="true"
        className={`size-2.5 shrink-0 rounded-full ${colorPreviewClassNames[channel.color]}`}
      />
      <span>{channel.number}</span>
    </span>
  );
}

function ChannelSelectValue({
  channel,
  placeholder,
}: {
  readonly channel:
    | Pick<Microphone, "color" | "number">
    | Pick<Mix, "color" | "number">
    | undefined;
  readonly placeholder: string;
}) {
  return channel ? <ChannelIdentity channel={channel} /> : placeholder;
}

export function useChatPresetResources(showId: ShowId) {
  const microphonesResult = useAtomValue(microphoneAtoms(showId).microphones);
  const mixesResult = useAtomValue(mixAtoms(showId).mixes);
  const microphones = React.useMemo(
    () =>
      AsyncResult.isSuccess(microphonesResult)
        ? microphonesResult.value.filter((item) => !item.deletedAt)
        : [],
    [microphonesResult],
  );
  const mixes = React.useMemo(
    () =>
      AsyncResult.isSuccess(mixesResult) ? mixesResult.value.filter((item) => !item.deletedAt) : [],
    [mixesResult],
  );
  return { microphones, mixes } as const;
}

export function initialChatPresetValues(
  fields: ReadonlyArray<ChatPresetField>,
  microphones: ReadonlyArray<Microphone>,
  mixes: ReadonlyArray<Mix>,
) {
  return Object.fromEntries(
    fields.map((field) => [
      field.name,
      field.type === "microphone"
        ? (microphones[0]?.id ?? "")
        : field.type === "mix"
          ? (mixes[0]?.id ?? "")
          : field.type === "select"
            ? (field.options[0] ?? "")
            : "",
    ]),
  );
}

export function resolveChatPresetDefinition(
  definition: TemplateDefinition,
  values: Readonly<Record<string, string>>,
  microphones: ReadonlyArray<Microphone>,
  mixes: ReadonlyArray<Mix>,
) {
  const parts = new Map<string, ChatMessagePart>(
    definition.context?.map((item) => [item.name, item.part]),
  );
  for (const field of definition.fields) {
    const value = values[field.name]?.trim() ?? "";
    if (!value) return undefined;
    if (field.type === "microphone") {
      const microphone = microphones.find((item) => item.id === value);
      if (!microphone) return undefined;
      parts.set(field.name, {
        type: "microphone",
        id: microphone.id,
        number: microphone.number,
        color: microphone.color,
        ...(microphone.name ? { name: microphone.name } : {}),
        text: `Mic ${microphone.number}${microphone.name ? ` (${microphone.name})` : ""}`,
      });
    } else if (field.type === "mix") {
      const mix = mixes.find((item) => item.id === value);
      if (!mix) return undefined;
      parts.set(field.name, {
        type: "mix",
        id: mix.id,
        number: mix.number,
        color: mix.color,
        ...(mix.name ? { name: mix.name } : {}),
        text: `Mix ${mix.number}${mix.name ? ` (${mix.name})` : ""}`,
      });
    } else {
      parts.set(field.name, { type: "text", text: value });
    }
  }
  const resolved = resolveChatPresetTemplate(definition.template, parts);
  return resolved ? { ...resolved, values: parts } : undefined;
}

export function ChatPresetFieldInputs({
  fields,
  values,
  microphones,
  mixes,
  onValueChange,
}: {
  readonly fields: ReadonlyArray<ChatPresetField>;
  readonly values: Readonly<Record<string, string>>;
  readonly microphones: ReadonlyArray<Microphone>;
  readonly mixes: ReadonlyArray<Mix>;
  readonly onValueChange: (name: string, value: string) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {fields.map((field, index) => {
        const label = readableChatPresetFieldName(field.name);
        if (field.type === "select" && chatPresetOptionsUseButtons(field.options)) {
          return (
            <fieldset key={field.name} className="grid content-start gap-1.5 text-sm">
              <legend className="font-medium">{label}</legend>
              <div className="grid grid-cols-2 gap-2">
                {field.options.map((option) => (
                  <Button
                    key={option}
                    type="button"
                    variant={values[field.name] === option ? "default" : "outline"}
                    aria-pressed={values[field.name] === option}
                    onClick={() => onValueChange(field.name, option)}
                  >
                    {option}
                  </Button>
                ))}
              </div>
            </fieldset>
          );
        }
        return (
          <label key={field.name} className="grid content-start gap-1.5 text-sm">
            <span className="font-medium">{label}</span>
            {field.type === "microphone" ? (
              <Select
                value={values[field.name] || null}
                onValueChange={(value) => value && onValueChange(field.name, value)}
              >
                <SelectTrigger autoFocus={index === 0} aria-label={label}>
                  <SelectValue>
                    <ChannelSelectValue
                      channel={microphones.find((item) => item.id === values[field.name])}
                      placeholder="Choose microphone"
                    />
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {microphones.map((microphone) => (
                    <SelectItem key={microphone.id} value={microphone.id}>
                      <ChannelIdentity channel={microphone} />
                      {microphone.name ? ` — ${microphone.name}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : field.type === "mix" ? (
              <Select
                value={values[field.name] || null}
                onValueChange={(value) => value && onValueChange(field.name, value)}
              >
                <SelectTrigger autoFocus={index === 0} aria-label={label}>
                  <SelectValue>
                    <ChannelSelectValue
                      channel={mixes.find((item) => item.id === values[field.name])}
                      placeholder="Choose mix"
                    />
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {mixes.map((mix) => (
                    <SelectItem key={mix.id} value={mix.id}>
                      <ChannelIdentity channel={mix} />
                      {mix.name ? ` — ${mix.name}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : field.type === "select" ? (
              <Select
                value={values[field.name] || null}
                onValueChange={(value) => value && onValueChange(field.name, value)}
              >
                <SelectTrigger autoFocus={index === 0} aria-label={label}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {field.options.map((option) => (
                    <SelectItem key={option} value={option}>
                      {option}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                autoFocus={index === 0}
                type={field.type === "number" ? "number" : "text"}
                inputMode={field.type === "number" ? "decimal" : undefined}
                value={values[field.name] ?? ""}
                placeholder={field.type === "number" ? "Enter number" : "Enter text"}
                onChange={(event) => onValueChange(field.name, event.currentTarget.value)}
              />
            )}
          </label>
        );
      })}
    </div>
  );
}
