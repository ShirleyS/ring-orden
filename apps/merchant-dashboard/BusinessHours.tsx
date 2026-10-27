"use client";
import { useState } from "react";
import { Plus, X, Check, Loader2, Clock } from "lucide-react";
import type { Obj } from "./types";
import { Modal } from "./App";
const days = [
  ["mon", "Monday"],
  ["tue", "Tuesday"],
  ["wed", "Wednesday"],
  ["thu", "Thursday"],
  ["fri", "Friday"],
  ["sat", "Saturday"],
  ["sun", "Sunday"],
];
export default function BusinessHours({
  business,
  onClose,
  onSave,
}: {
  business: Obj;
  onClose: () => void;
  onSave: (values: Obj) => Promise<any>;
}) {
  const [schedule, setSchedule] = useState<Obj>(
    business.schedule ||
      Object.fromEntries(
        days.map(([key]) => [
          key,
          {
            enabled: true,
            open: ["sat", "sun"].includes(key) ? "08:00" : "07:00",
            close: ["sat", "sun"].includes(key) ? "18:00" : "20:00",
          },
        ]),
      ),
  );
  const [closures, setClosures] = useState<string[]>(
      business.special_closures || [],
    ),
    [date, setDate] = useState(""),
    [busy, setBusy] = useState(false);
  const update = (day: string, values: Obj) =>
    setSchedule({ ...schedule, [day]: { ...schedule[day], ...values } });
  return (
    <Modal
      title="Your opening hours"
      subtitle="Your agent follows your hours in your business’s timezone."
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const summary = days
            .map(
              ([key, name]) =>
                `${name.slice(0, 3)} ${schedule[key].enabled ? schedule[key].open + "–" + schedule[key].close : "closed"}`,
            )
            .join(" · ");
          const r = await onSave({
            schedule,
            special_closures: closures,
            hours: summary,
          });
          setBusy(false);
          if (r) onClose();
        }}
      >
        <div className="modal-body form">
          <div className="hours-zone">
            <Clock size={16} />
            {business.timezone || "America/Mexico_City"}
          </div>
          <div className="hours-list">
            {days.map(([key, name]) => (
              <div key={key}>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={schedule[key]?.enabled ?? false}
                    onChange={(e) => update(key, { enabled: e.target.checked })}
                  />
                  {name}
                </label>
                {schedule[key]?.enabled ? (
                  <div>
                    <input
                      type="time"
                      aria-label={name + " opens"}
                      value={schedule[key].open}
                      required
                      onChange={(e) => update(key, { open: e.target.value })}
                    />
                    <span>–</span>
                    <input
                      type="time"
                      aria-label={name + " closes"}
                      value={schedule[key].close}
                      required
                      onChange={(e) => update(key, { close: e.target.value })}
                    />
                  </div>
                ) : (
                  <span className="muted">Closed</span>
                )}
              </div>
            ))}
          </div>
          <p className="field-help">
            Closing before opening supports overnight hours. Matching times mean
            open 24 hours.
          </p>
          <label>
            Special closures
            <div className="closure-add">
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                aria-label="Closure date"
              />
              <button
                type="button"
                className="secondary"
                disabled={!date || closures.includes(date)}
                onClick={() => {
                  setClosures([...closures, date].sort());
                  setDate("");
                }}
              >
                <Plus size={15} />
                Add
              </button>
            </div>
          </label>
          <div className="closure-tags">
            {closures.map((d) => (
              <span key={d}>
                {d}
                <button
                  type="button"
                  aria-label={"Remove closure " + d}
                  onClick={() => setClosures(closures.filter((c) => c !== d))}
                >
                  <X size={13} />
                </button>
              </span>
            ))}
          </div>
        </div>
        <div className="modal-footer">
          <button className="secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            {busy ? (
              <Loader2 className="spin" size={15} />
            ) : (
              <Check size={15} />
            )}
            Save hours
          </button>
        </div>
      </form>
    </Modal>
  );
}
