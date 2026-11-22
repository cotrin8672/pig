/** pi-ask-user's `ask_user` arguments and answers, shared by the host and the Composer panel. */
export type AskOption = { title: string; description?: string };
export type AskQuestion = {
  question: string;
  context?: string;
  options: AskOption[];
  allowMultiple: boolean;
  allowFreeform: boolean;
};
/** pi-ask-user's AskResponse: what its custom() prompt resolves with. */
export type AskAnswer =
  | { kind: "selection"; selections: string[]; comment?: string }
  | { kind: "freeform"; text: string };

type Value = Record<string, unknown>;
const obj = (value: unknown): Value =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Value)
    : {};
const text = (value: unknown) =>
  typeof value === "string" ? value.trim() : "";

export const askOptions = (value: unknown): AskOption[] =>
  Array.isArray(value)
    ? value.flatMap((option) => {
        const title =
          typeof option === "string" ? option.trim() : text(obj(option).title);
        const description = text(obj(option).description);
        return title ? [description ? { title, description } : { title }] : [];
      })
    : [];

function question(entry: Value): AskQuestion | undefined {
  const asked = text(entry.question);
  if (!asked) return undefined;
  const context = text(entry.context);
  return {
    question: asked,
    ...(context ? { context } : {}),
    options: askOptions(entry.options),
    allowMultiple: entry.allowMultiple === true,
    allowFreeform: entry.allowFreeform !== false,
  };
}

/** Same normalization as pi-ask-user; undefined when it would reject the call. */
export function askQuestions(args: unknown):
  | {
      batch: boolean;
      heading?: string;
      questions: AskQuestion[];
      allowComment: boolean;
      timeout?: number;
    }
  | undefined {
  const a = obj(args);
  const timeout =
    typeof a.timeout === "number" && a.timeout > 0 ? a.timeout : undefined;
  const common = { allowComment: a.allowComment === true, timeout };
  if (Array.isArray(a.questions)) {
    const questions = a.questions.map((entry) => question(obj(entry)));
    if (questions.length < 2 || questions.length > 4) return undefined;
    if (questions.some((entry) => !entry)) return undefined;
    const heading = text(a.question);
    return {
      batch: true,
      ...(heading ? { heading } : {}),
      questions: questions as AskQuestion[],
      ...common,
    };
  }
  const single = question(a);
  return single && { batch: false, questions: [single], ...common };
}

/** An answer the question allows; selections must name its options. */
export function validAskAnswer(
  entry: AskQuestion,
  answer: AskAnswer,
  allowComment: boolean,
): boolean {
  if (answer.kind === "freeform")
    return (
      (entry.allowFreeform || !entry.options.length) &&
      typeof answer.text === "string" &&
      !!answer.text.trim()
    );
  if (answer.kind !== "selection" || !Array.isArray(answer.selections))
    return false;
  const titles = new Set(entry.options.map((option) => option.title));
  return (
    answer.selections.length > 0 &&
    (entry.allowMultiple || answer.selections.length === 1) &&
    new Set(answer.selections).size === answer.selections.length &&
    answer.selections.every((title) => titles.has(title)) &&
    (answer.comment === undefined ||
      (allowComment && typeof answer.comment === "string"))
  );
}
