export default function NoteTemplatePicker({ templates, onApply, disabled }) {
  if (!templates?.length) return null;
  return (
    <div className="bl-card p-4">
      <div className="label-eyebrow mb-2">Treatment template</div>
      <p className="text-xs text-[#5C6C62] mb-3">Apply a preset to pre-fill common fields. You can edit before saving.</p>
      <div className="flex flex-wrap gap-2">
        {templates.map((t) => (
          <button
            key={t.id}
            type="button"
            disabled={disabled}
            onClick={() => onApply(t)}
            className="text-xs px-3 py-1.5 rounded-full border border-[#EAE6D7] bg-white text-[#2D3A33] hover:border-[#8A9A86] disabled:opacity-50"
            data-testid={`note-template-${t.id}`}
          >
            {t.name}
          </button>
        ))}
      </div>
    </div>
  );
}
