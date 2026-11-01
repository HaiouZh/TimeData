import { useRef, useState, type KeyboardEvent } from "react";
import { addQuickNote } from "../../lib/quickNotes.js";

/** 全貌顶部的速记入口框，打一句按「丢进去」就变成一条速记。 */
export function OverviewEntryBox(props: { wide: boolean; onSubmitted?: () => void }): React.JSX.Element {
  const { wide, onSubmitted } = props;
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  async function submit(): Promise<void> {
    if (inFlightRef.current) return;
    const submitted = text;
    if (submitted.trim() === "") return;
    inFlightRef.current = true;
    setSubmitting(true);
    setError(null);
    setSaved(false);
    try {
      await addQuickNote(submitted);
      setText((current) => (current.startsWith(submitted) ? current.slice(submitted.length).trimStart() : current));
      setSaved(true);
      onSubmitted?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      inFlightRef.current = false;
      setSubmitting(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key !== "Enter") return;
    // 组字中的回车是确认候选词，原样让给输入法
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if (!wide || event.shiftKey) return;
    event.preventDefault();
    void submit();
  }

  return (
    <div className="rounded-card border border-border bg-surface p-2">
      <textarea
        aria-label="丢进来"
        value={text}
        rows={wide ? 1 : 2}
        placeholder="丢进来……（链接、关键词、半句话都行，不用分类）"
        onChange={(event) => {
          setText(event.target.value);
          setSaved(false);
        }}
        onKeyDown={handleKeyDown}
        className="w-full resize-none bg-transparent px-2 py-1 text-ink placeholder:text-ink-3 outline-none"
      />
      <div className="flex items-center justify-end gap-2 px-2 pt-1">
        {error !== null ? (
          <p role="alert" className="mr-auto td-text-caption text-danger">
            {error}
          </p>
        ) : saved ? (
          <p role="status" className="mr-auto td-text-caption text-accent-ink">
            已收下，在「散着」里
          </p>
        ) : null}
        <button
          type="button"
          disabled={submitting || text.trim() === ""}
          onClick={() => void submit()}
          className="shrink-0 rounded-ctl bg-accent px-3 py-1.5 td-text-label text-page transition hover:bg-accent-strong disabled:cursor-not-allowed disabled:bg-surface-hover disabled:text-ink-3"
        >
          丢进去
        </button>
      </div>
    </div>
  );
}
