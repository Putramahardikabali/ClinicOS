export default function FollowUpFields({ data, setData, editable, prefix = "" }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      <div>
        <label className="label-eyebrow block mb-2">Follow-up recommendation</label>
        <textarea
          disabled={!editable}
          className="bl-input min-h-[90px]"
          value={data.follow_up_recommendation || ""}
          onChange={(e) => setData({ ...data, follow_up_recommendation: e.target.value })}
          placeholder="e.g. Review in 2 weeks, call if swelling persists"
          data-testid={`${prefix}follow-up`}
        />
      </div>
      <div>
        <label className="label-eyebrow block mb-2">Next treatment / session</label>
        <textarea
          disabled={!editable}
          className="bl-input min-h-[90px]"
          value={data.next_session_recommendation || ""}
          onChange={(e) => setData({ ...data, next_session_recommendation: e.target.value })}
          placeholder="e.g. HIFU session 2 in 4–6 weeks, maintenance Botox in 3 months"
          data-testid={`${prefix}next-session`}
        />
      </div>
    </div>
  );
}
