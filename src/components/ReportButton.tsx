/** "Download PDF report" button shared by the village sidebars and the survey-number cards. */
export function ReportButton({ label, hint, onClick, onExcel, busy, testid }: { label: string; hint?: string; onClick: () => void; onExcel?: () => void; busy: boolean; testid: string }) {
  return (
    <div className="rounded border border-emerald-200 bg-emerald-50/70 p-2 text-xs">
      <button
        type="button"
        data-testid={testid}
        disabled={busy}
        onClick={onClick}
        className="flex w-full items-center justify-center gap-1.5 rounded bg-emerald-800 px-2 py-1.5 font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="size-3.5">
          <path d="M12 3v12m0 0l-4-4m4 4l4-4M4 21h16" />
        </svg>
        {busy ? "Generating report…" : label}
      </button>
      {onExcel && (
        <button type="button" data-testid={`${testid}-xlsx`} disabled={busy} onClick={onExcel} className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded border border-emerald-800 bg-white px-2 py-1.5 font-semibold text-emerald-900 hover:bg-emerald-50 disabled:opacity-50">
          Download resources (Excel)
        </button>
      )}
      {hint && <div className="mt-1 text-[10px] text-slate-500">{hint}</div>}
    </div>
  );
}
