import { useId } from "react";

// "Enable Denomination" checkbox shared by Collection Entry and Payment Entry. Shown only
// for a Cash-in-Hand account; the Cash Denomination popup opens only when it is ticked,
// and denomination entry stays optional (it never blocks saving).
// It sits inside the Payment Mode field (itself a <label>), so it is a <span> rather than a
// nested <label>: the checkbox is directly clickable, and clicking the text toggles it
// without activating the surrounding field label.
export default function DenominationToggle({ checked, onChange }) {
  const id = useId();
  return <span className="denomination-toggle">
    <input id={id} type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} />
    <span role="presentation" onClick={event => { event.preventDefault(); onChange(!checked); }}>Enable Denomination</span>
  </span>;
}
