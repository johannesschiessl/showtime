import { useRpcMutation } from "@/hooks/useRpcMutation";
import * as React from "react";
import { Exit } from "effect";
import {
  bindChatPresetAnswer,
  chatPresetPlaceholderNames,
  chatsSyncKey,
  validateChatPresetAnswerDefinition,
  validateChatPresetDefinition,
  type ChatMessagePart,
  type ChatPreset,
  type ChatPresetAnswer,
  type ChatPresetField,
  type ChatPresetName,
  type ChatPresetTemplate,
  type ProfileId,
  type ShowId,
} from "@showtime/contracts";
import {
  ArrowLeftIcon,
  ArrowUpIcon,
  EllipsisIcon,
  FilePlus2Icon,
  LibraryIcon,
  Mic2Icon,
  PencilIcon,
  PlusIcon,
  SpeakerIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { chatAtoms, rpcErrorMessageFromCause } from "@/client";
import {
  ChatPresetFieldInputs,
  initialChatPresetValues,
  resolveChatPresetDefinition,
  useChatPresetResources,
} from "@/components/chats/ChatPresetFields";
import {
  chatPresetDraftsForTemplate,
  chatPresetFieldDrafts,
  chatPresetFieldsFromDrafts,
  type ChatPresetFieldDraft,
} from "@/components/chats/ChatPresetDrafts";
import { ChatMessageBody } from "@/components/chats/ChatMessageBody";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

export type ChatPresetDialogMode =
  | { readonly type: "list" }
  | { readonly type: "use"; readonly preset: ChatPreset }
  | { readonly type: "edit"; readonly preset?: ChatPreset }
  | { readonly type: "delete"; readonly preset: ChatPreset };

const fieldTypeLabels: Record<ChatPresetField["type"], string> = {
  microphone: "Microphone",
  mix: "Mix",
  text: "Text",
  number: "Number",
  select: "Options",
};

export function ChatPresetDialog({
  open,
  onOpenChange,
  showId,
  profileId,
  presets,
  onSend,
  initialMode = { type: "list" },
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly showId: ShowId;
  readonly profileId: ProfileId;
  readonly presets: ReadonlyArray<ChatPreset>;
  readonly onSend: (
    body: string,
    parts: ReadonlyArray<ChatMessagePart>,
    answer?: ChatPresetAnswer,
  ) => Promise<string | undefined>;
  readonly initialMode?: ChatPresetDialogMode;
}) {
  const [mode, setMode] = React.useState<ChatPresetDialogMode>(initialMode);

  React.useEffect(() => {
    if (!open) setMode({ type: "list" });
  }, [open]);

  const back = () => setMode({ type: "list" });
  const title =
    mode.type === "list"
      ? "Message presets"
      : mode.type === "use"
        ? mode.preset.name
        : mode.type === "delete"
          ? "Delete preset?"
          : mode.preset
            ? "Edit preset"
            : "New preset";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            {mode.type !== "list" && (
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label="Back to presets"
                onClick={back}
              >
                <ArrowLeftIcon />
              </Button>
            )}
            <DialogTitle>{title}</DialogTitle>
          </div>
          <DialogDescription>
            {mode.type === "list"
              ? "Choose a prepared message or create one for this show."
              : mode.type === "use"
                ? "Fill the few details below, then send."
                : mode.type === "delete"
                  ? `“${mode.preset.name}” will be permanently removed.`
                  : "Use {{name}} placeholders for the details that change each time."}
          </DialogDescription>
        </DialogHeader>

        {mode.type === "list" && (
          <PresetList
            presets={presets}
            onUse={(preset) => setMode({ type: "use", preset })}
            onEdit={(preset) => setMode({ type: "edit", preset })}
            onDelete={(preset) => setMode({ type: "delete", preset })}
            onCreate={() => setMode({ type: "edit" })}
          />
        )}
        {mode.type === "use" && (
          <UsePreset
            key={mode.preset.id}
            preset={mode.preset}
            showId={showId}
            onSend={async (body, parts, answer) => {
              const error = await onSend(body, parts, answer);
              if (!error) onOpenChange(false);
              return error;
            }}
          />
        )}
        {mode.type === "edit" && (
          <PresetEditor
            key={mode.preset?.id ?? "new"}
            showId={showId}
            profileId={profileId}
            preset={mode.preset}
            onSaved={(preset) => setMode({ type: "use", preset })}
          />
        )}
        {mode.type === "delete" && (
          <DeletePreset
            showId={showId}
            profileId={profileId}
            preset={mode.preset}
            onDeleted={back}
            onCancel={back}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function PresetList({
  presets,
  onUse,
  onEdit,
  onDelete,
  onCreate,
}: {
  readonly presets: ReadonlyArray<ChatPreset>;
  readonly onUse: (preset: ChatPreset) => void;
  readonly onEdit: (preset: ChatPreset) => void;
  readonly onDelete: (preset: ChatPreset) => void;
  readonly onCreate: () => void;
}) {
  return (
    <>
      <ScrollArea className="max-h-[55dvh]">
        <div className="space-y-2 pr-2">
          {presets.length === 0 ? (
            <div className="grid min-h-40 place-content-center gap-2 text-center text-muted-foreground">
              <LibraryIcon className="mx-auto size-6" />
              <p className="text-sm">No presets yet</p>
              <p className="text-xs">Create one to send common messages in a few taps.</p>
            </div>
          ) : (
            presets.map((preset) => (
              <Item key={preset.id} variant="outline">
                <button
                  type="button"
                  className="min-w-0 flex-1 rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  onClick={() => onUse(preset)}
                >
                  <ItemContent>
                    <ItemTitle>{preset.name}</ItemTitle>
                    <ItemDescription>{preset.template}</ItemDescription>
                  </ItemContent>
                </button>
                <ItemActions>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          type="button"
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Actions for ${preset.name}`}
                        />
                      }
                    >
                      <EllipsisIcon />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" sideOffset={6}>
                      <DropdownMenuItem onClick={() => onEdit(preset)}>
                        <PencilIcon />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem variant="destructive" onClick={() => onDelete(preset)}>
                        <Trash2Icon />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </ItemActions>
              </Item>
            ))
          )}
        </div>
      </ScrollArea>
      <DialogFooter>
        <Button type="button" onClick={onCreate}>
          <FilePlus2Icon /> New preset
        </Button>
      </DialogFooter>
    </>
  );
}

function UsePreset({
  preset,
  showId,
  onSend,
}: {
  readonly preset: ChatPreset;
  readonly showId: ShowId;
  readonly onSend: (
    body: string,
    parts: ReadonlyArray<ChatMessagePart>,
    answer?: ChatPresetAnswer,
  ) => Promise<string | undefined>;
}) {
  const { microphones, mixes } = useChatPresetResources(showId);
  const [values, setValues] = React.useState<Record<string, string>>(() =>
    initialChatPresetValues(preset.fields, microphones, mixes),
  );
  const [sending, setSending] = React.useState(false);
  const [error, setError] = React.useState<string>();

  React.useEffect(() => {
    setValues((current) => {
      const defaults = initialChatPresetValues(preset.fields, microphones, mixes);
      return Object.fromEntries(
        Object.entries(defaults).map(([name, value]) => [name, current[name] || value]),
      );
    });
  }, [mixes, microphones, preset]);

  const resolved = resolveChatPresetDefinition(preset, values, microphones, mixes);
  const answer =
    preset.answer && resolved ? bindChatPresetAnswer(preset.answer, resolved.values) : undefined;
  const ready = Boolean(resolved && (!preset.answer || answer));
  const setValue = (name: string, value: string) =>
    setValues((current) => ({ ...current, [name]: value }));
  const send = async () => {
    if (!resolved || !ready || sending) return;
    setSending(true);
    setError(undefined);
    const nextError = await onSend(resolved.body, resolved.parts, answer);
    if (nextError) setError(nextError);
    setSending(false);
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <ChatPresetFieldInputs
        fields={preset.fields}
        values={values}
        microphones={microphones}
        mixes={mixes}
        onValueChange={setValue}
      />
      <div className="rounded-lg border bg-muted/40 p-3 text-sm whitespace-pre-wrap">
        {resolved ? (
          <ChatMessageBody body={resolved.body} parts={resolved.parts} />
        ) : (
          <span className="text-muted-foreground">Complete the fields to preview the message.</span>
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button type="submit" disabled={!ready || sending}>
          {sending ? <Spinner /> : <ArrowUpIcon />} Send message
        </Button>
      </DialogFooter>
    </form>
  );
}

function PresetTemplateEditor({
  label,
  template,
  drafts,
  placeholder,
  inheritedNames = [],
  onTemplateChange,
  onDraftsChange,
}: {
  readonly label: string;
  readonly template: string;
  readonly drafts: ReadonlyArray<ChatPresetFieldDraft>;
  readonly placeholder: string;
  readonly inheritedNames?: ReadonlyArray<string>;
  readonly onTemplateChange: (value: string) => void;
  readonly onDraftsChange: React.Dispatch<React.SetStateAction<Array<ChatPresetFieldDraft>>>;
}) {
  return (
    <div className="space-y-3">
      <label className="grid gap-1.5 text-sm">
        <span className="font-medium">{label}</span>
        <Textarea
          value={template}
          maxLength={4_000}
          rows={3}
          placeholder={placeholder}
          onChange={(event) => onTemplateChange(event.currentTarget.value)}
        />
        <span className="text-xs text-muted-foreground">
          Wrap each changing detail in double braces.
        </span>
      </label>
      {inheritedNames.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Filled from the message: {inheritedNames.map((name) => `{{${name}}}`).join(", ")}
        </p>
      )}
      {drafts.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium">Details to fill</p>
          {drafts.map((field) => (
            <div
              key={field.name}
              className="grid gap-2 rounded-lg border p-2 sm:grid-cols-[1fr_10rem]"
            >
              <div className="min-w-0">
                <code className="text-sm">{`{{${field.name}}}`}</code>
                {field.type === "select" && (
                  <PresetOptionsEditor
                    fieldName={field.name}
                    options={field.options}
                    onChange={(options) =>
                      onDraftsChange((current) =>
                        current.map((item) =>
                          item.name === field.name ? { ...item, options } : item,
                        ),
                      )
                    }
                  />
                )}
              </div>
              <Select
                value={field.type}
                onValueChange={(value) =>
                  value &&
                  onDraftsChange((current) =>
                    current.map((item) =>
                      item.name === field.name
                        ? {
                            ...item,
                            type: value as ChatPresetField["type"],
                            options:
                              value === "select" && item.options.length === 0 ? [""] : item.options,
                          }
                        : item,
                    ),
                  )
                }
              >
                <SelectTrigger aria-label={`Type for ${field.name}`}>
                  <SelectValue>{fieldTypeLabels[field.type]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="microphone">
                    <span className="flex items-center gap-2">
                      <Mic2Icon className="size-4" /> Microphone
                    </span>
                  </SelectItem>
                  <SelectItem value="mix">
                    <span className="flex items-center gap-2">
                      <SpeakerIcon className="size-4" /> Mix
                    </span>
                  </SelectItem>
                  <SelectItem value="text">Text</SelectItem>
                  <SelectItem value="number">Number</SelectItem>
                  <SelectItem value="select">Options</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PresetOptionsEditor({
  fieldName,
  options,
  onChange,
}: {
  readonly fieldName: string;
  readonly options: ReadonlyArray<string>;
  readonly onChange: (options: ReadonlyArray<string>) => void;
}) {
  return (
    <div className="mt-2 space-y-2">
      {options.map((option, index) => (
        <div key={index} className="flex gap-2">
          <Input
            value={option}
            maxLength={120}
            placeholder={`Option ${index + 1}`}
            aria-label={`Option ${index + 1} for ${fieldName}`}
            onChange={(event) =>
              onChange(
                options.map((item, itemIndex) =>
                  itemIndex === index ? event.currentTarget.value : item,
                ),
              )
            }
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`Remove option ${index + 1} for ${fieldName}`}
            onClick={() => onChange(options.filter((_, itemIndex) => itemIndex !== index))}
          >
            <XIcon />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...options, ""])}>
        <PlusIcon /> Add option
      </Button>
    </div>
  );
}

function PresetEditor({
  showId,
  profileId,
  preset,
  onSaved,
}: {
  readonly showId: ShowId;
  readonly profileId: ProfileId;
  readonly preset?: ChatPreset;
  readonly onSaved: (preset: ChatPreset) => void;
}) {
  const atoms = chatAtoms(showId, profileId);
  const createPreset = useRpcMutation(atoms.createPreset);
  const updatePreset = useRpcMutation(atoms.updatePreset);
  const [name, setName] = React.useState(preset?.name ?? "");
  const [template, setTemplate] = React.useState(preset?.template ?? "");
  const [drafts, setDrafts] = React.useState<Array<ChatPresetFieldDraft>>(() =>
    chatPresetFieldDrafts(preset?.fields ?? []),
  );
  const [answerEnabled, setAnswerEnabled] = React.useState(Boolean(preset?.answer));
  const [answerTemplate, setAnswerTemplate] = React.useState(preset?.answer?.template ?? "");
  const [answerDrafts, setAnswerDrafts] = React.useState<Array<ChatPresetFieldDraft>>(() =>
    chatPresetFieldDrafts(preset?.answer?.fields ?? []),
  );
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string>();

  const changeTemplate = (value: string) => {
    setTemplate(value);
    setDrafts((current) => chatPresetDraftsForTemplate(value, current));
    const messageNames = new Set(chatPresetPlaceholderNames(value));
    setAnswerDrafts((current) =>
      chatPresetDraftsForTemplate(answerTemplate, current, messageNames),
    );
  };
  const changeAnswerTemplate = (value: string) => {
    setAnswerTemplate(value);
    setAnswerDrafts((current) =>
      chatPresetDraftsForTemplate(value, current, new Set(chatPresetPlaceholderNames(template))),
    );
  };
  const fields = chatPresetFieldsFromDrafts(drafts);
  const answerFields = chatPresetFieldsFromDrafts(answerDrafts);
  const messageFieldNames = chatPresetPlaceholderNames(template);
  const answerFieldNames = new Set(answerFields.map((field) => field.name));
  const inheritedAnswerNames = chatPresetPlaceholderNames(answerTemplate).filter(
    (name) => messageFieldNames.includes(name) && !answerFieldNames.has(name),
  );
  const definitionError = template.trim()
    ? validateChatPresetDefinition({ template: template.trim(), fields })
    : undefined;
  const answerDefinitionError =
    answerEnabled && answerTemplate.trim()
      ? validateChatPresetAnswerDefinition(
          { template: answerTemplate.trim(), fields: answerFields },
          messageFieldNames,
        )
      : undefined;
  const canSave = Boolean(
    name.trim() &&
    template.trim() &&
    !definitionError &&
    (!answerEnabled || (answerTemplate.trim() && !answerDefinitionError)),
  );

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSave || saving) return;
    setSaving(true);
    setError(undefined);
    const common = {
      showId,
      name: name.trim() as ChatPresetName,
      template: template.trim() as ChatPresetTemplate,
      fields,
      ...(answerEnabled
        ? {
            answer: {
              template: answerTemplate.trim() as ChatPresetTemplate,
              fields: answerFields,
            } satisfies ChatPresetAnswer,
          }
        : {}),
    };
    const exit = preset
      ? await updatePreset({
          payload: { ...common, presetId: preset.id },
          reactivityKeys: chatsSyncKey(showId),
        })
      : await createPreset({ payload: common, reactivityKeys: chatsSyncKey(showId) });
    if (Exit.isFailure(exit)) setError(rpcErrorMessageFromCause(exit.cause));
    else onSaved(exit.value);
    setSaving(false);
  };

  return (
    <form className="space-y-4" onSubmit={save}>
      <label className="grid gap-1.5 text-sm">
        <span className="font-medium">Preset name</span>
        <Input
          autoFocus
          value={name}
          maxLength={80}
          placeholder="e.g. Monitor change"
          onChange={(event) => setName(event.currentTarget.value)}
        />
      </label>
      <PresetTemplateEditor
        label="Message"
        template={template}
        drafts={drafts}
        placeholder="Put {{mic}} in {{mix}} at {{level}}"
        onTemplateChange={changeTemplate}
        onDraftsChange={setDrafts}
      />
      <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
        <div>
          <p className="text-sm font-medium">Request an answer</p>
          <p className="text-xs text-muted-foreground">
            Let recipients answer this message with a prepared response.
          </p>
        </div>
        <Switch
          checked={answerEnabled}
          aria-label="Request an answer"
          onCheckedChange={setAnswerEnabled}
        />
      </div>
      {answerEnabled && (
        <PresetTemplateEditor
          label="Answer"
          template={answerTemplate}
          drafts={answerDrafts}
          placeholder="{{mic}} is {{status}}"
          inheritedNames={inheritedAnswerNames}
          onTemplateChange={changeAnswerTemplate}
          onDraftsChange={setAnswerDrafts}
        />
      )}
      {definitionError && template.trim() && (
        <p role="alert" className="text-xs text-destructive">
          {definitionError}
        </p>
      )}
      {answerDefinitionError && answerTemplate.trim() && (
        <p role="alert" className="text-xs text-destructive">
          Answer: {answerDefinitionError}
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button type="submit" disabled={!canSave || saving}>
          {saving ? <Spinner /> : null}
          {preset ? "Save changes" : "Create preset"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function DeletePreset({
  showId,
  profileId,
  preset,
  onDeleted,
  onCancel,
}: {
  readonly showId: ShowId;
  readonly profileId: ProfileId;
  readonly preset: ChatPreset;
  readonly onDeleted: () => void;
  readonly onCancel: () => void;
}) {
  const remove = useRpcMutation(chatAtoms(showId, profileId).deletePreset);
  const [deleting, setDeleting] = React.useState(false);
  const [error, setError] = React.useState<string>();
  const confirm = async () => {
    setDeleting(true);
    setError(undefined);
    const exit = await remove({
      payload: { showId, presetId: preset.id },
      reactivityKeys: chatsSyncKey(showId),
    });
    if (Exit.isFailure(exit)) setError(rpcErrorMessageFromCause(exit.cause));
    else onDeleted();
    setDeleting(false);
  };
  return (
    <>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" disabled={deleting} onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" variant="destructive" disabled={deleting} onClick={confirm}>
          <Trash2Icon /> {deleting ? "Deleting..." : "Delete"}
        </Button>
      </DialogFooter>
    </>
  );
}
